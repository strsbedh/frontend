import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Eye, ArrowLeft, Copy, Check, Zap, LogOut } from 'lucide-react';
import ConnectionStatus from '../components/ConnectionStatus';
import ControlPanel from '../components/ControlPanel';
import LogsPanel from '../components/LogsPanel';
import { RTC_CONFIG } from '../utils/webrtc';
import { getWsUrl } from '../utils/signaling';

export default function ViewerPage() {
  const { deviceId } = useParams();
  const navigate = useNavigate();

  // INSTANCE DEBUG: Detect duplicate mounts
  const instanceId = useRef(Math.random().toString(36).substring(7));
  console.log('🔥 VIEWER INSTANCE:', instanceId.current, 'deviceId:', deviceId);

  const [connectionState, setConnectionState] = useState('disconnected');
  const [deviceName, setDeviceName] = useState('');
  const [logs, setLogs] = useState([]);
  const [controlActive, setControlActive] = useState(false);
  const [blackScreen, setBlackScreen] = useState(false);
  const [blockInput, setBlockInput] = useState(false);
  const [hasStream, setHasStream] = useState(false);
  const [channelOpen, setChannelOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [quality, setQuality] = useState('medium');
  const [audioMode, setAudioMode] = useState('off');
  const [viewerId, setViewerId] = useState(null); // Store viewer_id from backend

  const viewerMicStreamRef = useRef(null); // viewer's mic stream for 2-way

  const videoRef = useRef(null);
  const containerRef = useRef(null);
  const wsRef = useRef(null);
  const pcRef = useRef(null);
  const dataChannelRef = useRef(null);
  const reconnectTimerRef = useRef(null);
  const lastMoveRef = useRef(0);
  const connectingRef = useRef(false); // LOCK: prevents multiple simultaneous connections
  const keepaliveIntervalRef = useRef(null); // Keepalive ping interval
  const wsConnectingRef = useRef(false); // LOCK: prevents multiple WebSocket connections
  const wsHeartbeatIntervalRef = useRef(null); // WebSocket heartbeat ping interval
  const replacedRef = useRef(false); // Track if we were replaced (prevent reconnect)
  const clipboardIntervalRef = useRef(null); // Clipboard monitoring interval

  const addLog = useCallback((category, message) => {
    const time = new Date().toLocaleTimeString('en-US', {
      hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit',
    });
    // Include viewer_id in system logs for connection tracking
    const logMessage = viewerId && category === 'system' ? `[${viewerId}] ${message}` : message;
    setLogs(prev => [...prev.slice(-200), { time, category, message: logMessage }]);
  }, [viewerId]);

  const sendEvent = useCallback((event) => {
    if (dataChannelRef.current?.readyState === 'open') {
      dataChannelRef.current.send(JSON.stringify(event));
    }
  }, []);

  const cleanupPeer = useCallback(() => {
    console.log('[viewer] Cleaning up peer connection...');
    
    if (keepaliveIntervalRef.current) {
      clearInterval(keepaliveIntervalRef.current);
      keepaliveIntervalRef.current = null;
    }
    if (clipboardIntervalRef.current) {
      clearInterval(clipboardIntervalRef.current);
      clipboardIntervalRef.current = null;
    }
    // Stop viewer mic
    if (viewerMicStreamRef.current) {
      viewerMicStreamRef.current.getTracks().forEach(t => t.stop());
      viewerMicStreamRef.current = null;
    }
    if (pcRef.current) {
      pcRef.current.close();
      pcRef.current = null;
    }
    dataChannelRef.current = null;
    connectingRef.current = false;
    setHasStream(false);
    setChannelOpen(false);
    // Note: Don't reset viewerId here as it's tied to the WebSocket connection, not peer connection
  }, []);

  const cleanupWebSocket = useCallback(() => {
    console.log('[viewer] 🧹 Cleaning up WebSocket...');
    
    // Clear heartbeat interval
    if (wsHeartbeatIntervalRef.current) {
      clearInterval(wsHeartbeatIntervalRef.current);
      wsHeartbeatIntervalRef.current = null;
      console.log('[viewer] ✅ WebSocket heartbeat interval cleared');
    }
    
    // Clear reconnect timer
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
      console.log('[viewer] ✅ Reconnect timer cleared');
    }
    
    // Close WebSocket if exists
    if (wsRef.current) {
      const ws = wsRef.current;
      const state = ws.readyState;
      console.log('[viewer] 🔌 Closing old WebSocket (state:', state, ')');
      
      // Remove all event listeners to prevent callbacks
      ws.onopen = null;
      ws.onmessage = null;
      ws.onclose = null;
      ws.onerror = null;
      
      // Close if not already closed
      if (state === WebSocket.OPEN || state === WebSocket.CONNECTING) {
        try {
          ws.close();
          console.log('[viewer] ✅ WebSocket closed');
        } catch (err) {
          console.warn('[viewer] ⚠️  Error closing WebSocket:', err.message);
        }
      }
      
      wsRef.current = null;
    }
    
    wsConnectingRef.current = false; // Release WebSocket lock
    
    // Reset viewer ID when WebSocket connection is lost
    setViewerId(null);
    
    // RELEASE GLOBAL LOCK
    window.__VIEWER_ACTIVE__ = false;
    console.log('[viewer] 🔓 Global viewer lock released');
  }, []);

  // ── Handle WebRTC offer from host ──
  const handleOffer = useCallback(async (data) => {
    console.log('[viewer] 📥 Received offer from host');

    // FIX 1: DO NOT RECREATE PEER IF ONE EXISTS AND IS STABLE
    // BUT allow renegotiation offers (when peer is already connected)
    if (pcRef.current && pcRef.current.connectionState === 'connected') {
      // Renegotiation — just update remote description and send answer
      console.log('[viewer] 🔄 Renegotiation offer received — updating remote description');
      try {
        await pcRef.current.setRemoteDescription(new RTCSessionDescription(data.sdp));
        const answer = await pcRef.current.createAnswer();
        await pcRef.current.setLocalDescription(answer);
        const answerMessage = {
          type: 'answer',
          sdp: { type: pcRef.current.localDescription.type, sdp: pcRef.current.localDescription.sdp },
        };
        // Include viewer_id for routing if available (backward compatibility)
        if (viewerId) {
          answerMessage.viewer_id = viewerId;
        }
        wsRef.current.send(JSON.stringify(answerMessage));
        console.log('[viewer] ✅ Renegotiation answer sent');
      } catch (err) {
        console.error('[viewer] ❌ Renegotiation failed:', err.message);
      }
      return;
    }

    // If peer exists but is NOT connected (stale/disconnected/connecting), clean it up
    if (pcRef.current) {
      console.log('[viewer] 🧹 Cleaning up stale peer (state:', pcRef.current.connectionState, ')');
      pcRef.current.close();
      pcRef.current = null;
      dataChannelRef.current = null;
      connectingRef.current = false;
    }

    // SET CONNECTION LOCK
    connectingRef.current = true;
    console.log('[viewer] 🔒 Connection lock acquired');

    // Cleanup only if peer is in failed/closed state
    if (pcRef.current) {
      console.log('[viewer] Closing previous peer connection (state:', pcRef.current.connectionState, ')');
      pcRef.current.close();
      pcRef.current = null;
    }

    console.log('[viewer] Creating RTCPeerConnection with config:', RTC_CONFIG);
    const pc = new RTCPeerConnection(RTC_CONFIG);
    pcRef.current = pc;

    // Track event handler — receives host screen + mic audio
    pc.ontrack = (event) => {
      console.log('[viewer] 📥 TRACK RECEIVED:', event.track.kind, event.streams.length, 'stream(s)');

      if (event.track.kind === 'video' && videoRef.current && event.streams[0]) {
        videoRef.current.srcObject = event.streams[0];
        setHasStream(true);
        addLog('system', 'Receiving screen stream');
      }

      if (event.track.kind === 'audio') {
        // Play host audio automatically
        const audio = document.createElement('audio');
        audio.srcObject = event.streams[0] || new MediaStream([event.track]);
        audio.autoplay = true;
        audio.volume = 1;
        document.body.appendChild(audio);
        audio.play().catch(() => {});
        // Clean up when track ends
        event.track.onended = () => {
          audio.remove();
        };
        addLog('system', 'Host audio active');
        console.log('[viewer] 🔊 Playing host audio');
      }
    };

    // DataChannel handler (VIEWER SIDE - receives channel from host)
    pc.ondatachannel = (event) => {
      const ch = event.channel;
      dataChannelRef.current = ch;
      console.log('[viewer] 📡 DataChannel received:', ch.label);
      
      ch.onopen = () => {
        setChannelOpen(true);
        setConnectionState('streaming');
        addLog('system', 'Control channel open');
        console.log('[viewer] ✅ DataChannel OPEN');
        connectingRef.current = false; // Release lock on successful connection
        
        // Start keepalive ping to prevent idle closure
        if (keepaliveIntervalRef.current) clearInterval(keepaliveIntervalRef.current);
        keepaliveIntervalRef.current = setInterval(() => {
          if (dataChannelRef.current?.readyState === 'open') {
            try {
              dataChannelRef.current.send(JSON.stringify({ type: 'ping' }));
              console.log('[viewer] 📡 Keepalive ping sent');
            } catch (err) {
              console.warn('[viewer] ⚠️  Keepalive ping failed:', err.message);
            }
          }
        }, 5000); // Ping every 5 seconds
        
        // Start clipboard monitoring (browser)
        let lastClipboard = '';
        if (clipboardIntervalRef.current) clearInterval(clipboardIntervalRef.current);
        clipboardIntervalRef.current = setInterval(async () => {
          if (dataChannelRef.current?.readyState !== 'open') {
            if (clipboardIntervalRef.current) {
              clearInterval(clipboardIntervalRef.current);
              clipboardIntervalRef.current = null;
            }
            return;
          }
          
          // Clipboard API requires secure context — skip silently if unavailable
          if (!navigator.clipboard || !navigator.clipboard.readText) return;

          try {
            const text = await navigator.clipboard.readText();
            if (text && text.length > 1024 * 1024) return; // too large
            if (text && text !== lastClipboard) {
              lastClipboard = text;
              dataChannelRef.current.send(JSON.stringify({ type: 'clipboard', text }));
              console.log(`[viewer] 📋 Clipboard synced to host (${text.length} chars)`);
            }
          } catch {
            // Silently fail — clipboard permission may not be granted
          }
        }, 1000);
      };
      
      ch.onclose = () => {
        setChannelOpen(false);
        addLog('system', 'Control channel closed');
        console.log('[viewer] ⚠️  DataChannel CLOSED (not treating as disconnect)');
        // CRITICAL: DO NOT cleanup peer - let peer connection state handle it
        
        // Clear keepalive
        if (keepaliveIntervalRef.current) {
          clearInterval(keepaliveIntervalRef.current);
          keepaliveIntervalRef.current = null;
        }
      };
      
      ch.onerror = (err) => {
        console.error('[viewer] ❌ DataChannel error:', err);
        // Don't cleanup - let peer connection state handle it
      };
      
      ch.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          // Handle ping messages (ignore)
          if (msg.type === 'ping' || msg.type === 'pong') {
            return;
          }
          
          // Handle clipboard sync from host
          if (msg.type === 'clipboard') {
            if (msg.text && msg.text.length <= 1024 * 1024) {
              // Guard: Clipboard API requires secure context (HTTPS)
              if (navigator.clipboard && navigator.clipboard.writeText) {
                navigator.clipboard.writeText(msg.text).then(() => {
                  console.log(`[viewer] 📋 Clipboard updated from host (${msg.text.length} chars)`);
                  addLog('system', 'Clipboard synced from host');
                }).catch(err => {
                  console.warn('[viewer] ⚠️  Clipboard write failed (may need HTTPS):', err.message);
                });
              } else {
                // Fallback for non-secure contexts
                try {
                  const el = document.createElement('textarea');
                  el.value = msg.text;
                  el.style.position = 'fixed';
                  el.style.opacity = '0';
                  document.body.appendChild(el);
                  el.select();
                  document.execCommand('copy');
                  document.body.removeChild(el);
                  console.log(`[viewer] 📋 Clipboard updated via fallback (${msg.text.length} chars)`);
                } catch {
                  console.warn('[viewer] ⚠️  Clipboard fallback also failed');
                }
              }
            } else if (msg.text && msg.text.length > 1024 * 1024) {
              console.warn('[viewer] 📋 Clipboard content from host too large (>1MB) — ignoring');
            }
            return;
          }
          
          console.log('[viewer] 📨 DataChannel message:', msg);
        } catch (err) {
          console.error('[viewer] ❌ Error parsing DataChannel message:', err);
        }
      };
    };

    // ICE candidate handler
    pc.onicecandidate = (event) => {
      if (event.candidate) {
        console.log('[viewer] 🧊 ICE candidate:', event.candidate.type, event.candidate.protocol);
        if (wsRef.current?.readyState === WebSocket.OPEN) {
          const candidateMessage = {
            type: 'ice-candidate',
            candidate: event.candidate.toJSON(),
          };
          // Include viewer_id for routing if available (backward compatibility)
          if (viewerId) {
            candidateMessage.viewer_id = viewerId;
          }
          wsRef.current.send(JSON.stringify(candidateMessage));
        }
      } else {
        console.log('[viewer] 🧊 ICE gathering complete');
      }
    };

    // Connection state monitoring
    pc.oniceconnectionstatechange = () => {
      console.log('[viewer] 🧊 ICE CONNECTION STATE:', pc.iceConnectionState);
      if (pc.iceConnectionState === 'failed') {
        connectingRef.current = false; // Release lock on failure
      }
    };

    // Connection state monitoring (SOURCE OF TRUTH)
    pc.onconnectionstatechange = () => {
      const st = pc.connectionState;
      console.log('[viewer] 🔌 PEER CONNECTION STATE:', st);
      addLog('system', `Peer: ${st}`);
      
      if (st === 'connected') {
        console.log('[viewer] ✅ Peer connection established');
        connectingRef.current = false; // Release lock on success
        setConnectionState('streaming');
      } else if (st === 'disconnected') {
        console.warn('[viewer] ⚠️  Peer DISCONNECTED (waiting before cleanup)');
        setConnectionState('waiting');
        setHasStream(false);
        setChannelOpen(false);
        
        // Wait before cleanup to allow reconnection
        setTimeout(() => {
          if (pcRef.current && pcRef.current.connectionState === 'disconnected') {
            console.log('[viewer] 🧹 Cleaning up after disconnect timeout...');
            cleanupPeer();
          } else {
            console.log('[viewer] ✅ Connection recovered, skipping cleanup');
          }
        }, 3000);
      } else if (st === 'failed') {
        console.error('[viewer] ❌ Peer connection FAILED');
        connectingRef.current = false; // Release lock on failure
        setConnectionState('waiting');
        setHasStream(false);
        setChannelOpen(false);
        
        // Cleanup immediately on failure
        cleanupPeer();
      } else if (st === 'closed') {
        console.log('[viewer] 🔒 Peer connection CLOSED');
        setConnectionState('waiting');
      }
    };

    // Set remote description and create answer
    console.log('[viewer] Setting remote description...');
    await pc.setRemoteDescription(new RTCSessionDescription(data.sdp));
    console.log('[viewer] ✅ Remote description set');
    
    console.log('[viewer] Creating answer...');
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    console.log('[viewer] ✅ Local description set');

    const answerMessage = {
      type: 'answer',
      sdp: { type: pc.localDescription.type, sdp: pc.localDescription.sdp },
    };
    // Include viewer_id for routing if available (backward compatibility)
    if (viewerId) {
      answerMessage.viewer_id = viewerId;
    }
    wsRef.current.send(JSON.stringify(answerMessage));
    console.log('[viewer] 📤 Answer sent to host');
    addLog('system', 'Answer sent');
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [addLog, viewerId]);

  // ── Signaling message router ──
  const handleSignalingMessage = useCallback(async (data) => {
    console.log('[viewer] 📨 WS message:', data.type);
    
    switch (data.type) {
      case 'connected':
        console.log('[viewer] ✅ Connected to device:', data.device_name || deviceId);
        addLog('system', `Connected to ${data.device_name || deviceId}`);
        setDeviceName(data.device_name || deviceId);
        
        // Capture and store viewer_id from connection response
        if (data.viewer_id) {
          setViewerId(data.viewer_id);
          console.log('[viewer] 📋 Viewer ID assigned:', data.viewer_id);
          addLog('system', `Viewer ID: ${data.viewer_id}`);
        }
        
        setConnectionState('waiting');
        break;
        
      case 'offer':
        console.log('[viewer] 📥 Offer received from host');
        addLog('system', 'Offer received from host');
        await handleOffer(data);
        break;
        
      case 'ice-candidate':
        if (pcRef.current && data.candidate) {
          await pcRef.current.addIceCandidate(new RTCIceCandidate(data.candidate));
          console.log('[viewer] 🧊 ICE candidate added');
        }
        break;
        
      case 'host_disconnected':
        console.log('[viewer] ⚠️  Host went offline');
        addLog('system', 'Host went offline');
        setConnectionState('disconnected');
        cleanupPeer();
        break;
        
      case 'replaced':
        console.log('[viewer] ⚠️  Replaced by another viewer - DO NOT RECONNECT');
        addLog('system', 'Replaced by another viewer');
        setConnectionState('disconnected');
        replacedRef.current = true; // Mark as replaced to prevent reconnect
        cleanupPeer();
        cleanupWebSocket(); // Clean up WebSocket to prevent reconnect
        break;
        
      case 'pong':
        // Silently handle pong messages
        break;
        
      case 'error':
        console.error('[viewer] ❌ Server error:', data.message);
        addLog('error', data.message);
        setConnectionState('disconnected');
        break;
        
      default:
        console.log('[viewer] Unknown message type:', data.type);
        break;
    }
  }, [addLog, deviceId, handleOffer, cleanupPeer, cleanupWebSocket]);

  // ── Connect signaling WebSocket ──
  const connectSignaling = useCallback(() => {
    // CRITICAL: Check if we were replaced - DO NOT reconnect (FIRST CHECK)
    if (replacedRef.current) {
      console.log('[viewer] 🚫 BLOCKED — viewer was replaced');
      return;
    }
    
    // CRITICAL: HARD LOCK - Check WebSocket state FIRST
    if (wsRef.current && (
      wsRef.current.readyState === WebSocket.OPEN ||
      wsRef.current.readyState === WebSocket.CONNECTING
    )) {
      console.log('[viewer] 🚫 BLOCKED — WS already active (state:', wsRef.current.readyState, ')');
      return;
    }
    
    // CRITICAL: Check connecting lock
    if (wsConnectingRef.current === true) {
      console.log('[viewer] 🚫 BLOCKED — already connecting');
      return;
    }
    
    // CRITICAL: Global lock to prevent multiple viewer instances
    if (window.__VIEWER_ACTIVE__) {
      console.log('[viewer] 🚫 BLOCKED — viewer already active globally (another instance exists)');
      return;
    }
    
    // Clean up old WebSocket if it exists and is closed/closing
    if (wsRef.current) {
      const state = wsRef.current.readyState;
      console.log('[viewer] 🧹 Cleaning up old WebSocket before reconnect (state:', state, ')');
      cleanupWebSocket();
    }
    
    // SET ALL LOCKS
    wsConnectingRef.current = true;
    window.__VIEWER_ACTIVE__ = true;
    console.log('[viewer] 🔒 ALL LOCKS ACQUIRED');
    console.log('[viewer] 🔌 Creating WebSocket connection...');

    const url = getWsUrl(`/api/ws/viewer/${deviceId}`);
    const ws = new WebSocket(url);
    wsRef.current = ws;

    ws.onopen = () => {
      console.log('[viewer] ✅ WebSocket OPEN');
      addLog('system', 'Signaling connected');

      // Reset connection lock — fresh WebSocket session means fresh start
      connectingRef.current = false;

      // Start heartbeat ping (every 5 seconds)
      if (wsHeartbeatIntervalRef.current) clearInterval(wsHeartbeatIntervalRef.current);
      wsHeartbeatIntervalRef.current = setInterval(() => {
        if (wsRef.current?.readyState === WebSocket.OPEN) {
          try {
            wsRef.current.send(JSON.stringify({ type: 'ping' }));
            console.log('[viewer] 💓 WebSocket heartbeat ping sent');
          } catch (err) {
            console.warn('[viewer] ⚠️  WebSocket heartbeat ping failed:', err.message);
          }
        }
      }, 5000);
    };
    
    ws.onmessage = (event) => {
      try {
        handleSignalingMessage(JSON.parse(event.data));
      } catch (err) {
        console.error('[viewer] ❌ Error parsing WebSocket message:', err);
      }
    };
    
    ws.onclose = (event) => {
      console.log('[viewer] 🔌 WebSocket CLOSED (code:', event.code, 'reason:', event.reason || 'none', ')');
      // Reset lock ONLY on close
      wsConnectingRef.current = false;
      window.__VIEWER_ACTIVE__ = false;
      console.log('[viewer] 🔓 Locks released on close');
      
      addLog('system', 'Signaling lost');
      setConnectionState('disconnected');
      
      // Clear heartbeat
      if (wsHeartbeatIntervalRef.current) {
        clearInterval(wsHeartbeatIntervalRef.current);
        wsHeartbeatIntervalRef.current = null;
      }
      
      // Only reconnect if not replaced
      if (!replacedRef.current) {
        console.log('[viewer] 🔄 Scheduling reconnect in 3 seconds...');
        reconnectTimerRef.current = setTimeout(() => {
          console.log('[viewer] 🔄 Reconnect timer fired');
          connectSignaling();
        }, 3000);
      } else {
        console.log('[viewer] 🚫 Skipping reconnect - viewer was replaced');
      }
    };
    
    ws.onerror = (err) => {
      console.error('[viewer] ❌ WebSocket error:', err);
      // Reset lock on error
      wsConnectingRef.current = false;
      window.__VIEWER_ACTIVE__ = false;
      console.log('[viewer] 🔓 Locks released on error');
      addLog('error', 'WebSocket error');
    };
  }, [deviceId, addLog, handleSignalingMessage, cleanupWebSocket]);

  // ── Event capture helpers ──
  const getCoords = useCallback((e) => {
    const el = containerRef.current;
    if (!el) return null;
    
    // Simple coordinate calculation relative to the container that receives events
    const r = el.getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width;
    const y = (e.clientY - r.top) / r.height;
    
    console.log('[DEBUG] Fixed frontend coordinate calculation:', {
      clientX: e.clientX,
      clientY: e.clientY,
      rectLeft: r.left,
      rectTop: r.top,
      rectWidth: r.width,
      rectHeight: r.height,
      finalX: x,
      finalY: y,
      element: 'containerRef'
    });
    
    return (x >= 0 && x <= 1 && y >= 0 && y <= 1) ? { x, y } : null;
  }, []);

  const handleMouseMove = useCallback((e) => {
    if (!controlActive) return;
    const now = Date.now();
    if (now - lastMoveRef.current < 33) return;
    lastMoveRef.current = now;
    const c = getCoords(e);
    if (c) sendEvent({ type: 'mouse_move', ...c });
  }, [controlActive, sendEvent, getCoords]);

  const handleClick = useCallback((e) => {
    if (!controlActive) return;
    containerRef.current?.focus();
    const c = getCoords(e);
    if (c) {
      sendEvent({ type: 'mouse_click', ...c, button: e.button });
      addLog('sent', `Click (${(c.x * 100).toFixed(1)}%, ${(c.y * 100).toFixed(1)}%)`);
    }
  }, [controlActive, sendEvent, addLog, getCoords]);

  const handleContextMenu = useCallback((e) => {
    if (controlActive) { e.preventDefault(); handleClick(e); }
  }, [controlActive, handleClick]);

  const handleKeyDown = useCallback(async (e) => {
    if (!controlActive) return;
    e.preventDefault();
    e.stopPropagation();

    // Remap Alt+[key] → Win+[key] on host when control is active
    // (Win key can't be captured by browser — Alt combos are the best proxy)
    if (e.altKey && !e.ctrlKey && !e.shiftKey) {
      const winMap = {
        'r': 'win+r',   // Alt+R → Win+R (Run)
        'd': 'win+d',   // Alt+D → Win+D (Desktop)
        'e': 'win+e',   // Alt+E → Win+E (Explorer)
        's': 'win+s',   // Alt+S → Win+S (Search)
        'i': 'win+i',   // Alt+I → Win+I (Settings)
        'x': 'win+x',   // Alt+X → Win+X (Quick menu)
        'm': 'win+m',   // Alt+M → Win+M (Minimize all)
        'p': 'win+p',   // Alt+P → Win+P (Project)
        'v': 'win+v',   // Alt+V → Win+V (Clipboard history)
      };
      const mapped = winMap[e.key.toLowerCase()];
      if (mapped && dataChannelRef.current?.readyState === 'open') {
        dataChannelRef.current.send(JSON.stringify({ type: 'win_shortcut', keys: mapped }));
        addLog('sent', `Alt+${e.key.toUpperCase()} → ${mapped}`);
        return;
      }
    }

    // Special case: Ctrl+V — push viewer clipboard to host FIRST, then send the keystroke
    if (e.ctrlKey && e.key === 'v') {
      try {
        let text = '';
        if (navigator.clipboard && navigator.clipboard.readText) {
          text = await navigator.clipboard.readText();
        }
        if (text && dataChannelRef.current?.readyState === 'open') {
          dataChannelRef.current.send(JSON.stringify({ type: 'clipboard', text }));
          await new Promise(r => setTimeout(r, 150));
        }
      } catch {
        // Clipboard read failed (HTTP context) — just send the keystroke anyway
      }
    }

    sendEvent({
      type: 'key_down',
      key: e.key,
      code: e.code,
      ctrlKey: e.ctrlKey,
      shiftKey: e.shiftKey,
      altKey: e.altKey,
      metaKey: e.metaKey,
    });
    addLog('sent', `Key DOWN: "${e.key}"${e.ctrlKey?' Ctrl':''}${e.shiftKey?' Shift':''}${e.altKey?' Alt':''}`);
  }, [controlActive, sendEvent, addLog]);

  const handleKeyUp = useCallback((e) => {
    if (!controlActive) return;
    e.preventDefault();
    e.stopPropagation();
    sendEvent({ type: 'key_up', key: e.key, code: e.code });
  }, [controlActive, sendEvent]);

  const handleWheel = useCallback((e) => {
    if (!controlActive) return;
    e.preventDefault();
    sendEvent({ type: 'scroll', deltaX: e.deltaX, deltaY: e.deltaY });
    addLog('sent', `Scroll dY:${e.deltaY.toFixed(0)}`);
  }, [controlActive, sendEvent, addLog]);

  // Toggle handlers - always send regardless of controlActive
  const toggleBlackScreen = (enabled) => {
    setBlackScreen(enabled);
    sendEvent({ type: 'toggle', action: 'black_screen', enabled });
    addLog('system', `Black screen ${enabled ? 'ON' : 'OFF'}`);
  };

  const toggleBlockInput = (enabled) => {
    setBlockInput(enabled);
    sendEvent({ type: 'toggle', action: 'block_input', enabled });
    addLog('system', `Block input ${enabled ? 'ON' : 'OFF'}`);
  };

  const copyDeviceId = () => {
    try { navigator.clipboard.writeText(deviceId); }
    catch {
      const el = document.createElement('textarea');
      el.value = deviceId;
      document.body.appendChild(el);
      el.select();
      document.execCommand('copy');
      document.body.removeChild(el);
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // Wheel listener with passive: false
  useEffect(() => {
    const el = containerRef.current;
    if (el && controlActive) {
      el.addEventListener('wheel', handleWheel, { passive: false });
      return () => el.removeEventListener('wheel', handleWheel);
    }
  }, [controlActive, handleWheel]);

  // CRITICAL: Attach keyboard listeners to document with capture:true
  // This intercepts Ctrl+V, Win+R, Alt+Tab etc. BEFORE the browser handles them
  useEffect(() => {
    if (!controlActive) return;
    document.addEventListener('keydown', handleKeyDown, { capture: true });
    document.addEventListener('keyup',   handleKeyUp,   { capture: true });
    return () => {
      document.removeEventListener('keydown', handleKeyDown, { capture: true });
      document.removeEventListener('keyup',   handleKeyUp,   { capture: true });
    };
  }, [controlActive, handleKeyDown, handleKeyUp]);

  // Send quality request to host when changed
  useEffect(() => {
    if (!channelOpen || !dataChannelRef.current) return;
    dataChannelRef.current.send(JSON.stringify({ type: 'set_quality', quality }));
    addLog('system', `Quality → ${quality}`);
  }, [quality, channelOpen, addLog]);

  // Handle audio mode changes
  const handleAudioModeChange = useCallback(async (mode) => {
    setAudioMode(mode);

    // Tell host to change audio mode
    if (dataChannelRef.current?.readyState === 'open') {
      dataChannelRef.current.send(JSON.stringify({ type: 'set_audio_mode', mode }));
    }

    // Stop existing viewer mic
    if (viewerMicStreamRef.current) {
      viewerMicStreamRef.current.getTracks().forEach(t => t.stop());
      viewerMicStreamRef.current = null;
    }

    // 2-way: capture viewer mic and add to peer connection
    if (mode === 'two_way' && pcRef.current) {
      // getUserMedia requires secure context (HTTPS) — check first
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        addLog('error', 'Mic unavailable — page must be served over HTTPS');
        console.error('[viewer] ❌ getUserMedia not available (requires HTTPS)');
        return;
      }
      try {
        const micStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
        viewerMicStreamRef.current = micStream;
        micStream.getAudioTracks().forEach(track => {
          pcRef.current.addTrack(track, micStream);
        });
        addLog('system', 'Your mic active (2-way)');
        console.log('[viewer] 🎤 Viewer mic added to peer');
      } catch (err) {
        addLog('error', 'Mic access denied: ' + err.message);
        console.error('[viewer] ❌ Mic capture failed:', err.message);
      }
    }
  }, [addLog]);

  // Connect on mount - ONLY RUN ONCE
  useEffect(() => {
    console.log('[viewer] 🚀 Component mounted - initializing connection');
    connectSignaling();
    
    return () => {
      console.log('[viewer] 🛑 Component unmounting - cleaning up');
      // Cleanup on unmount
      if (wsHeartbeatIntervalRef.current) {
        clearInterval(wsHeartbeatIntervalRef.current);
        wsHeartbeatIntervalRef.current = null;
      }
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
      if (pcRef.current) {
        pcRef.current.close();
        pcRef.current = null;
      }
      wsConnectingRef.current = false;
      window.__VIEWER_ACTIVE__ = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // EMPTY ARRAY - only run once on mount

  // Clean disconnect — closes WS properly so host gets viewer_disconnected immediately
  const handleDisconnect = useCallback(() => {
    console.log('[viewer] 🔌 Manual disconnect');
    // Stop viewer mic if active
    if (viewerMicStreamRef.current) {
      viewerMicStreamRef.current.getTracks().forEach(t => t.stop());
      viewerMicStreamRef.current = null;
    }
    // Close peer connection
    if (pcRef.current) {
      pcRef.current.close();
      pcRef.current = null;
    }
    dataChannelRef.current = null;
    connectingRef.current = false;
    // Close WebSocket cleanly — this triggers viewer_disconnected on the backend
    if (wsRef.current) {
      wsRef.current.onclose = null; // prevent auto-reconnect
      wsRef.current.close(1000, 'User disconnected');
      wsRef.current = null;
    }
    wsConnectingRef.current = false;
    window.__VIEWER_ACTIVE__ = false;
    replacedRef.current = false; // allow reconnect if user comes back
    setViewerId(null); // Reset viewer ID on manual disconnect
    navigate('/dashboard');
  }, [navigate]);

  return (
    <div className="min-h-screen bg-zinc-50" data-testid="viewer-page">
      {/* Header */}
      <header className="bg-white/90 backdrop-blur-xl border-b border-zinc-200 sticky top-0 z-50">
        <div className="max-w-[1600px] mx-auto px-4 md:px-8 py-3 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <button
              onClick={handleDisconnect}
              className="text-zinc-400 hover:text-zinc-700 transition-colors"
              data-testid="back-btn"
              title="Back to dashboard"
            >
              <ArrowLeft className="w-5 h-5" strokeWidth={1.5} />
            </button>
            <div className="flex items-center gap-2">
              <Eye className="w-5 h-5 text-[#002FA7]" strokeWidth={1.5} />
              <span className="font-heading font-bold text-zinc-950">{deviceName || 'Viewer'}</span>
              {viewerId && (
                <span className="text-xs font-mono text-zinc-500 bg-zinc-100 px-2 py-0.5 rounded" title="Viewer ID">
                  {viewerId}
                </span>
              )}
            </div>
          </div>
          <div className="flex items-center gap-4">
            <ConnectionStatus state={connectionState} />
            {connectionState === 'streaming' && (
              <button
                onClick={handleDisconnect}
                className="flex items-center gap-1.5 text-xs text-rose-600 hover:text-rose-800 border border-rose-200 hover:border-rose-400 px-3 py-1.5 rounded transition-colors"
                data-testid="disconnect-btn"
                title="Disconnect from host"
              >
                <LogOut className="w-3.5 h-3.5" strokeWidth={1.5} />
                Disconnect
              </button>
            )}
            <button
              onClick={copyDeviceId}
              className="flex items-center gap-2 bg-zinc-100 hover:bg-zinc-200 border border-zinc-200 px-3 py-1.5 transition-colors"
              data-testid="copy-device-btn"
            >
              <span className="font-mono text-sm font-bold tracking-widest text-zinc-700">{deviceId}</span>
              {copied ? (
                <Check className="w-3.5 h-3.5 text-green-600" strokeWidth={2} />
              ) : (
                <Copy className="w-3.5 h-3.5 text-zinc-400" strokeWidth={1.5} />
              )}
            </button>
          </div>
        </div>
      </header>

      {/* Main content */}
      <main className="max-w-[1600px] mx-auto p-4 md:p-8">
        <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
          {/* Video area */}
          <div className="lg:col-span-3">
            <div
              ref={containerRef}
              className={`video-container relative bg-black border border-zinc-200 aspect-video flex items-center justify-center ${controlActive ? 'capture-area' : ''}`}
              tabIndex={0}
              onMouseMove={handleMouseMove}
              onClick={handleClick}
              onContextMenu={handleContextMenu}
              data-testid="viewer-video-container"
            >
              <video
                ref={videoRef}
                autoPlay
                playsInline
                className={`w-full h-full object-contain ${hasStream ? '' : 'hidden'}`}
                data-testid="viewer-video"
              />
              {!hasStream && (
                <div className="text-center p-8 absolute inset-0 flex flex-col items-center justify-center">
                  <Eye className="w-12 h-12 text-zinc-600 mx-auto mb-4" strokeWidth={1} />
                  <p className="text-zinc-500 text-sm">
                    {connectionState === 'waiting'
                      ? 'Waiting for host screen...'
                      : connectionState === 'disconnected'
                        ? 'Host is offline'
                        : 'Connecting...'}
                  </p>
                </div>
              )}
              {controlActive && hasStream && (
                <div
                  className="absolute top-3 left-3 flex items-center gap-2 bg-[#002FA7]/90 text-white px-3 py-1 text-xs font-mono"
                  data-testid="control-active-badge"
                >
                  <div className="w-1.5 h-1.5 bg-white rounded-full animate-pulse" />
                  CONTROLLING
                </div>
              )}
            </div>

            {/* Status bar */}
            <div className="flex items-center gap-3 mt-3">
              {hasStream && (
                <div className="flex items-center gap-2 text-xs text-zinc-500 font-mono">
                  <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse" />
                  RECEIVING
                </div>
              )}
              {blackScreen && (
                <span className="text-xs font-mono text-amber-700 bg-amber-50 border border-amber-200 px-2 py-0.5" data-testid="black-screen-badge">
                  HOST SCREEN HIDDEN
                </span>
              )}
              {blockInput && (
                <span className="text-xs font-mono text-rose-600 bg-rose-50 border border-rose-200 px-2 py-0.5" data-testid="block-input-badge">
                  HOST INPUT BLOCKED
                </span>
              )}
              {/* Quality selector */}
              <div className="ml-auto flex items-center gap-2">
                <Zap className="w-3.5 h-3.5 text-zinc-400" strokeWidth={1.5} />
                <span className="text-xs text-zinc-400">Quality:</span>
                {['low', 'medium', 'high'].map(q => (
                  <button
                    key={q}
                    onClick={() => setQuality(q)}
                    className={`text-xs px-2 py-0.5 rounded transition-colors ${
                      quality === q
                        ? 'bg-[#002FA7] text-white'
                        : 'text-zinc-500 hover:text-zinc-800 border border-zinc-200'
                    }`}
                  >
                    {q.charAt(0).toUpperCase() + q.slice(1)}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Sidebar */}
          <div className="lg:col-span-1 flex flex-col gap-6">
            <ControlPanel
              controlActive={controlActive}
              onControlToggle={setControlActive}
              blackScreen={blackScreen}
              onBlackScreenToggle={toggleBlackScreen}
              blockInput={blockInput}
              onBlockInputToggle={toggleBlockInput}
              audioMode={audioMode}
              onAudioModeChange={handleAudioModeChange}
              disabled={!channelOpen}
            />

            {/* Windows Shortcuts Panel */}
            {channelOpen && (
              <div className="bg-white border border-zinc-200 divide-y divide-zinc-100">
                <div className="px-5 py-3">
                  <span className="text-xs font-bold uppercase tracking-[0.2em] text-zinc-500">Win Shortcuts</span>
                </div>
                <div className="px-5 py-2 bg-zinc-50">
                  <p className="text-xs text-zinc-400">Tip: <span className="font-mono text-zinc-500">Alt+R</span> → Win+R on host (when Take Control is ON)</p>
                </div>
                <div className="p-3 grid grid-cols-2 gap-1.5">
                  {[
                    { label: '⊞ Start',    keys: 'win'      },
                    { label: '⊞ + R',      keys: 'win+r'    },
                    { label: '⊞ + D',      keys: 'win+d'    },
                    { label: '⊞ + E',      keys: 'win+e'    },
                    { label: '⊞ + L',      keys: 'win+l'    },
                    { label: '⊞ + S',      keys: 'win+s'    },
                    { label: '⊞ + I',      keys: 'win+i'    },
                    { label: '⊞ + X',      keys: 'win+x'    },
                    { label: '⊞ + Tab',    keys: 'win+tab'  },
                    { label: '⊞ + V',      keys: 'win+v'    },
                    { label: 'Alt+F4',     keys: 'alt+f4'   },
                    { label: 'Alt+Tab',    keys: 'alt+tab'  },
                  ].map(({ label, keys }) => (
                    <button
                      key={keys}
                      onClick={() => {
                        if (dataChannelRef.current?.readyState === 'open') {
                          // Alt+F4 and Alt+Tab use regular key_down with modifiers
                          if (keys === 'alt+f4') {
                            dataChannelRef.current.send(JSON.stringify({ type: 'key_down', key: 'F4', code: 'F4', altKey: true }));
                          } else if (keys === 'alt+tab') {
                            dataChannelRef.current.send(JSON.stringify({ type: 'key_down', key: 'Tab', code: 'Tab', altKey: true }));
                          } else {
                            dataChannelRef.current.send(JSON.stringify({ type: 'win_shortcut', keys }));
                          }
                          addLog('sent', keys);
                        }
                      }}
                      className="text-xs px-2 py-1.5 bg-zinc-50 hover:bg-zinc-100 border border-zinc-200 rounded transition-colors text-zinc-700 font-mono"
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div className="h-[300px] lg:flex-1 lg:min-h-[300px]">
              <LogsPanel logs={logs} onClear={() => setLogs([])} title="Input Log" />
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
