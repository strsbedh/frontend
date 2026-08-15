import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/context/AuthContext';
import axios from 'axios';
import { API_URL } from '../utils/webrtc';
import { PRIVATE_DEVICE_IDS } from '../utils/privateAgents';

function formatTimeAgo(iso) {
  if (!iso) return null;
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ${mins % 60}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ${hrs % 24}h ago`;
}

function formatIdle(iso, isOnline) {
  if (isOnline) return 'Active';
  const ago = formatTimeAgo(iso);
  return ago ? `Idle ${ago}` : 'Offline';
}

export default function PrivatePage() {
  const navigate = useNavigate();
  const { logout } = useAuth();
  const [devices, setDevices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [selectedDeviceId, setSelectedDeviceId] = useState(null);
  const [showInfo, setShowInfo] = useState(false);

  const privateDevices = devices.filter(d => PRIVATE_DEVICE_IDS.includes(d.device_id));
  const selectedDevice = privateDevices.find(d => d.device_id === selectedDeviceId);

  const fetchDevices = useCallback(async () => {
    setError(null);
    try {
      const res = await axios.get(`${API_URL}/devices`);
      setDevices(res.data.devices || []);
    } catch (err) {
      setError('Failed to load devices');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchDevices();
    const interval = setInterval(fetchDevices, 1000);
    return () => clearInterval(interval);
  }, [fetchDevices]);

  return (
    <div className="h-screen flex overflow-hidden bg-[#101010] text-[#ccc] select-none" style={{ fontFamily: "'Segoe UI', Arial, sans-serif" }}>
      {/* ── LEFT SIDEBAR ── */}
      <div className="w-[220px] min-w-[220px] bg-[#101010] border-r border-[#101010] flex flex-col p-4 gap-3">
        <div>
          <h2 className="text-2xl font-bold text-white mb-0.5">Support</h2>
          <p className="text-xs text-[#888] leading-relaxed mb-1">
            License info is provided with your ID. Exceeded License will be Suspended permanently. Strict policy No refund.
          </p>
        </div>
        <button className="bg-[#00bcd4] text-white border-none rounded px-0 py-3 text-sm font-semibold cursor-pointer text-center w-full hover:bg-[#00acc1] transition-colors">
          Create +
        </button>
        <div className="flex items-center justify-between bg-[#1a1a2e] rounded px-3 py-2.5 cursor-pointer text-[#ddd] text-sm hover:bg-[#252538] transition-colors" onClick={() => navigate('/dashboard')}>
          <span className="font-semibold">My Sessions</span>
          <span className="bg-[#444] text-[#ccc] rounded px-[7px] py-[2px] text-xs font-bold">→</span>
        </div>
        <div className="flex items-center justify-between bg-[#252538] rounded px-3 py-2.5 cursor-pointer text-[#ddd] text-sm ring-1 ring-[#00bcd4]">
          <span className="font-semibold">Private</span>
          <span className="bg-[#00bcd4] text-white rounded px-[7px] py-[2px] text-xs font-bold">{privateDevices.length}</span>
        </div>
        <div className="flex-1" />
        <div className="flex items-center gap-2 text-xs text-[#555] cursor-pointer hover:text-[#aaa]" onClick={() => { logout(); navigate('/login'); }}>
          <span>&#10140;</span>
          <span>Sign out</span>
        </div>
      </div>

      {/* ── MIDDLE PANEL (device list) ── */}
      <div className="w-[480px] min-w-[480px] bg-[#101010] flex flex-col border-r border-[#2a2a3e]">
        <div className="flex items-center justify-between px-4 py-3 border-b border-[#2a2a3e]">
          <h3 className="text-base font-bold text-white">Private Sessions</h3>
        </div>

        <div className="flex-1 overflow-y-auto scrollbar-thin">
          {loading ? (
            <div className="text-center py-12 text-[#666] text-sm">Loading sessions...</div>
          ) : error && privateDevices.length === 0 ? (
            <div className="text-center py-12 text-[#666] text-sm">{error}</div>
          ) : privateDevices.length === 0 ? (
            <div className="text-center py-12 text-[#666] text-sm">No private sessions</div>
          ) : privateDevices.map(d => {
            const isOnline = d.status === 'online' || d.status === 'booting';
            const isSelected = d.device_id === selectedDeviceId;
            return (
              <div key={d.device_id}
                className={`flex items-center px-3 py-2.5 border-b border-[#1a1a2e] cursor-pointer gap-3 transition-all hover:bg-[#1a1a2e] ${isSelected ? 'bg-[#1a1a2e] border-l-2 border-l-[#00bcd4]' : ''}`}
                onClick={() => setSelectedDeviceId(d.device_id)}>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1">
                    <span className="text-[#ddd] text-sm font-semibold truncate">{d.device_name}</span>
                  </div>
                  <div className="text-[#777] text-xs truncate">Host: {d.device_id}</div>
                  {d.whoami && <div className="text-[#777] text-xs truncate">User: {d.whoami} ({formatIdle(d.last_seen, isOnline)})</div>}
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {isOnline ? (
                    <span className="text-[#4caf50] text-xs font-semibold border border-[#4caf50] rounded px-[5px] py-[1px] whitespace-nowrap">Active</span>
                  ) : (
                    <span className="text-[#555] text-base">&#9679;</span>
                  )}
                  <span className={`text-sm ${isOnline ? 'text-[#4caf50]' : 'text-[#555]'}`} title={`${d.viewer_count || 0} viewer(s) connected`}>&#127911;<span className="ml-0.5 text-xs font-semibold">{d.viewer_count || 0}</span></span>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* ── RIGHT PANEL (details, read-only) ── */}
      <div className="flex-1 bg-[#002129] flex flex-col min-w-0 max-w-[calc(100%-220px-480px-36px)]">
        <div className="px-4 py-3 border-b border-[#2a2a3e] flex items-center justify-between">
          <h3 className="text-base font-bold text-white truncate">{selectedDevice ? selectedDevice.device_name : 'Select a session'}</h3>
          {selectedDevice && (
            <div className="flex items-center gap-2 text-sm text-[#888]">
              {showInfo && (
                <button onClick={() => setShowInfo(false)} className="text-[#00bcd4] hover:text-[#00acc1] px-2 py-1 rounded bg-[#252538] transition-colors">&#10005; Close Info</button>
              )}
            </div>
          )}
        </div>

        {showInfo && selectedDevice && (
          <div className="border-b border-[#2a2a3e] bg-[#1c1c2c]">
            <div className="px-4 py-3 space-y-2">
              <div className="text-xs text-[#888]"><span className="text-[#aaa] font-semibold">ID:</span> {selectedDevice.device_id}</div>
              {selectedDevice.whoami && (
                <div className="text-xs text-[#888]"><span className="text-[#aaa] font-semibold">User:</span> {selectedDevice.whoami}</div>
              )}
              {selectedDevice.host_ip && (
                <div className="text-xs text-[#888]"><span className="text-[#aaa] font-semibold">IP:</span> {selectedDevice.host_ip}</div>
              )}
              <div className="text-xs text-[#888]">
                <span className="text-[#aaa] font-semibold">Status:</span>{' '}
                <span className={selectedDevice.status === 'online' || selectedDevice.status === 'booting' ? 'text-[#4caf50]' : 'text-[#555]'}>
                  {selectedDevice.status}
                </span>
              </div>
              <div className="text-xs text-[#888]"><span className="text-[#aaa] font-semibold">Last seen:</span> {formatTimeAgo(selectedDevice.last_seen) || 'Never'}</div>
            </div>
          </div>
        )}

        <div className="flex-1 overflow-y-auto px-3 py-2 flex flex-col gap-1.5 scrollbar-thin">
          {!selectedDevice ? (
            <div className="text-center py-12 text-[#555] text-sm">Select a session to view details</div>
          ) : (
            <div className="text-center py-12 text-[#555] text-sm">Read-only view. No actions available.</div>
          )}
        </div>
      </div>

      {/* ── FAR RIGHT ICON SIDEBAR ── */}
      <div className="w-[36px] min-w-[36px] bg-[#181826] border-l border-[#2a2a3e] flex flex-col items-center pt-3 gap-4">
        <span className={`text-base cursor-pointer p-1 transition-colors ${showInfo ? 'text-[#00bcd4]' : 'text-[#555] hover:text-[#aaa]'}`}
          title="Device Info" onClick={() => selectedDeviceId && setShowInfo(v => !v)}>&#9432;</span>
      </div>

      <style>{`
        .scrollbar-thin::-webkit-scrollbar { width: 5px; }
        .scrollbar-thin::-webkit-scrollbar-track { background: #101010; }
        .scrollbar-thin::-webkit-scrollbar-thumb { background: #444; border-radius: 2px; }
      `}</style>
    </div>
  );
}
