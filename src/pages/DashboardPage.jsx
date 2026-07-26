import { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/context/AuthContext';
import axios from 'axios';
import { API_URL } from '../utils/webrtc';

function formatTimeAgo(iso) {
  if (!iso) return null;
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ${mins % 60}m ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ${hrs % 24}h ago`;
}

function formatIdle(iso, isOnline) {
  if (isOnline) return 'Active';
  const ago = formatTimeAgo(iso);
  return ago ? `Idle ${ago}` : 'Offline';
}

export default function DashboardPage() {
  const navigate = useNavigate();
  const { logout } = useAuth();
  const [devices, setDevices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedDeviceId, setSelectedDeviceId] = useState(null);
  const [noteText, setNoteText] = useState('');
  const [noteData, setNoteData] = useState(null);
  const [noteLoading, setNoteLoading] = useState(false);
  const [noteSaving, setNoteSaving] = useState(false);

  const selectedDevice = devices.find(d => d.device_id === selectedDeviceId);

  const fetchDevices = useCallback(async () => {
    setError(null);
    try {
      const res = await axios.get(`${API_URL}/devices`);
      setDevices(res.data.devices || []);
    } catch (err) {
      setError('Failed to load devices');
      console.error('[dashboard] fetch failed:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchDevices();
    const interval = setInterval(fetchDevices, 15000);
    return () => clearInterval(interval);
  }, [fetchDevices]);

  const fetchNote = useCallback(async (deviceId) => {
    if (!deviceId) return;
    setNoteLoading(true);
    try {
      const res = await axios.get(`${API_URL}/device-note/${deviceId}`, { validateStatus: s => s === 200 || s === 404 });
      if (res.status === 200) {
        setNoteData(res.data);
        setNoteText(res.data.note || '');
      } else {
        setNoteData(null);
        setNoteText('');
      }
    } catch {
      setNoteData(null);
      setNoteText('');
    } finally {
      setNoteLoading(false);
    }
  }, []);

  useEffect(() => {
    if (selectedDeviceId) fetchNote(selectedDeviceId);
    else { setNoteData(null); setNoteText(''); }
  }, [selectedDeviceId, fetchNote]);

  const handleSaveNote = async () => {
    if (!selectedDeviceId || !noteText.trim()) return;
    setNoteSaving(true);
    try {
      const res = await axios.post(`${API_URL}/device-note`, { device_id: selectedDeviceId, note: noteText });
      setNoteData({ note: noteText, updated_at: res.data.updated_at });
    } catch { /* silent */ }
    finally { setNoteSaving(false); }
  };

  const handleDeleteNote = async () => {
    if (!selectedDeviceId) return;
    setNoteText('');
    setNoteSaving(true);
    try {
      await axios.post(`${API_URL}/device-note`, { device_id: selectedDeviceId, note: '' });
      setNoteData(null);
    } catch { /* silent */ }
    finally { setNoteSaving(false); }
  };

  const handleConnect = (deviceId) => {
    window.location.href = `rdviewer://connect/${deviceId}`;
  };

  const filtered = devices.filter(d => {
    const q = searchQuery.toLowerCase();
    return d.device_name.toLowerCase().includes(q) || d.device_id.toLowerCase().includes(q) || (d.whoami && d.whoami.toLowerCase().includes(q));
  });

  return (
    <div className="h-screen flex overflow-hidden bg-[#101010] text-[#ccc] text-xs select-none" style={{ fontFamily: "'Segoe UI', Arial, sans-serif" }}>
      {/* LEFT SIDEBAR */}
      <div className="w-[220px] min-w-[220px] bg-[#101010] border-r border-[#101010] flex flex-col p-4 gap-3">
        <div>
          <h2 className="text-xl font-bold text-white mb-0.5">Support</h2>
          <p className="text-[10.5px] text-[#888] leading-[1.4] mb-1">
            License info is provided with your ID. Exceeded License will be Suspended permanently. Strict policy No refund.
          </p>
        </div>
        <button className="bg-[#00bcd4] text-white border-none rounded px-0 py-2.5 text-[13px] font-semibold cursor-pointer text-center w-full hover:bg-[#00acc1] transition-colors">
          Create +
        </button>
        <div className="flex items-center justify-between bg-[#252538] rounded px-2.5 py-2 cursor-pointer text-[#ddd] text-[12.5px]">
          <span className="font-semibold">My Sessions</span>
          <span className="bg-[#444] text-[#ccc] rounded px-[7px] py-[2px] text-[11px] font-bold">{devices.length}</span>
        </div>
        <div className="flex-1" />
        <div className="flex items-center gap-2 text-[11px] text-[#555] cursor-pointer hover:text-[#aaa]" onClick={() => { logout(); navigate('/login'); }}>
          <span>&#10140;</span>
          <span>Sign out</span>
        </div>
      </div>

      {/* MIDDLE PANEL */}
      <div className="w-[420px] min-w-[420px] bg-[#101010] flex flex-col border-r border-[#2a2a3e]">
        <div className="flex items-center justify-between px-3.5 py-2.5 border-b border-[#2a2a3e]">
          <h3 className="text-[15px] font-bold text-white">My Sessions</h3>
          <div className="flex items-center gap-3 text-[#aaa] text-xs">
            <span className="flex items-center gap-1 cursor-pointer hover:text-white" onClick={() => selectedDeviceId && handleConnect(selectedDeviceId)}>
              <span className="text-[13px]">&#9654;</span> Join
            </span>
            <span className="text-[#555] cursor-default">&#8943;</span>
          </div>
        </div>

        <div className="px-3 py-2 border-b border-[#2a2a3e]">
          <div className="relative">
            <span className="absolute left-2 top-1/2 -translate-y-1/2 text-[#666] text-xs">&#128269;</span>
            <input type="text" placeholder="Search My Sessions" value={searchQuery} onChange={e => setSearchQuery(e.target.value)}
              className="w-full bg-[#252538] border border-[#333348] rounded text-[#ccc] px-2.5 py-1.5 pl-[30px] text-[11.5px] outline-none placeholder:text-[#666]" />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto scrollbar-thin">
          {loading ? (
            <div className="text-center py-8 text-[#666] text-xs">Loading sessions...</div>
          ) : error && filtered.length === 0 ? (
            <div className="text-center py-8 text-[#666] text-xs">{error}</div>
          ) : filtered.length === 0 ? (
            <div className="text-center py-8 text-[#666] text-xs">No sessions found</div>
          ) : filtered.map(d => {
            const isOnline = d.status === 'online' || d.status === 'booting';
            const isSelected = d.device_id === selectedDeviceId;
            return (
              <div key={d.device_id}
                className={`flex items-center px-2.5 py-2 border-b border-[#101010] cursor-pointer gap-2 transition-all hover:bg-[#1a1a2e] ${isSelected ? 'bg-[#1a1a2e] border-l-2 border-l-[#00bcd4]' : ''}`}
                onClick={() => setSelectedDeviceId(d.device_id)}>
                <input type="checkbox" className="accent-[#555] w-[13px] h-[13px] shrink-0" checked={isSelected} onChange={() => setSelectedDeviceId(d.device_id)} onClick={e => e.stopPropagation()} />
                <div className="flex-1 min-w-0">
                  <div className="text-[#ddd] text-xs font-semibold truncate">{d.device_name}</div>
                  <div className="text-[#777] text-[10.5px] truncate">Host: {d.device_id}</div>
                  {d.whoami && <div className="text-[#777] text-[10.5px] truncate">User: {d.whoami} ({formatIdle(d.last_seen, isOnline)})</div>}
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  {isOnline ? (
                    <span className="text-[#4caf50] text-[10.5px] border border-[#4caf50] rounded px-[5px] py-[1px] whitespace-nowrap">Active</span>
                  ) : (
                    <span className="text-[#555] text-[10.5px]">&#9679;</span>
                  )}
                  <span className="text-[#555] text-sm cursor-pointer hover:text-[#aaa]">&#128100;</span>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* RIGHT PANEL */}
      <div className="flex-1 bg-[#002129] flex flex-col min-w-0">
        <div className="px-4 py-3 border-b border-[#2a2a3e] flex items-center justify-between">
          <h3 className="text-[15px] font-bold text-white truncate">{selectedDevice ? selectedDevice.device_name : 'Select a session'}</h3>
          {selectedDevice && (
            <div className="flex items-center gap-2 text-[#888] text-xs">
              <button onClick={() => handleConnect(selectedDeviceId)} className="hover:text-white px-2 py-1 rounded bg-[#252538] hover:bg-[#333348] transition-colors">&#9654; Join</button>
            </div>
          )}
        </div>

        <div className="flex-1 overflow-y-auto px-3 py-2 flex flex-col gap-0.5 scrollbar-thin">
          {!selectedDevice ? (
            <div className="text-center py-12 text-[#555] text-xs">Select a session to view details</div>
          ) : noteLoading ? (
            <div className="text-center py-8 text-[#555] text-xs">Loading notes...</div>
          ) : noteData && noteData.note ? (
            <div className="bg-[#393939] rounded px-2.5 py-2.5 border-b border-[#252538]">
              <div className="flex items-center justify-between mb-1">
                <div className="flex items-baseline gap-2">
                  <span className="text-[11px] font-semibold text-[#ccc]">{selectedDevice.device_id}</span>
                  <span className="text-[10.5px] text-[#666]">{noteData.updated_at ? formatTimeAgo(noteData.updated_at) + ' ago' : ''}</span>
                </div>
                <button onClick={handleDeleteNote} className="bg-none border-none text-[#555] cursor-pointer text-[13px] hover:text-[#e57373] transition-colors">&#128465;</button>
              </div>
              <div className="text-[11.5px] text-[#888] leading-[1.4] whitespace-pre-wrap">{noteData.note}</div>
            </div>
          ) : (
            <div className="text-center py-8 text-[#555] text-xs">No notes yet</div>
          )}
        </div>

        {selectedDevice && (
          <div className="px-3 py-2.5 border-t border-[#2a2a3e] flex gap-2 items-center">
            <textarea placeholder="Enter a note" value={noteText} onChange={e => setNoteText(e.target.value)}
              className="flex-1 bg-[#252538] border border-[#333348] rounded text-[#ccc] px-2.5 py-1.5 text-[11.5px] outline-none resize-none h-[38px] font-inherit placeholder:text-[#555]" />
            <button onClick={handleSaveNote} disabled={noteSaving || !noteText.trim()}
              className="bg-[#00bcd4] text-white border-none rounded px-4 h-[38px] text-xs font-semibold cursor-pointer whitespace-nowrap hover:bg-[#00acc1] disabled:opacity-40 disabled:cursor-not-allowed transition-colors">
              {noteSaving ? '...' : 'Add Note'}
            </button>
          </div>
        )}
      </div>

      {/* FAR RIGHT ICON SIDEBAR */}
      <div className="w-[36px] min-w-[36px] bg-[#181826] border-l border-[#2a2a3e] flex flex-col items-center pt-2.5 gap-3.5">
        <span className="text-[#555] text-[15px] cursor-pointer p-1 hover:text-[#aaa] transition-colors">&#128279;</span>
        <span className="text-[#555] text-[15px] cursor-pointer p-1 hover:text-[#aaa] transition-colors">&#9432;</span>
        <span className="text-[#555] text-[15px] cursor-pointer p-1 hover:text-[#aaa] transition-colors">&#128336;</span>
        <span className="text-[#555] text-[15px] cursor-pointer p-1 hover:text-[#aaa] transition-colors">&#128172;</span>
        <span className="text-[#00bcd4] text-[15px] cursor-pointer p-1 transition-colors">&#128196;</span>
        <span className="text-[#555] text-[15px] cursor-pointer p-1 hover:text-[#aaa] transition-colors">&#9881;</span>
      </div>

      <style>{`
        .scrollbar-thin::-webkit-scrollbar { width: 4px; }
        .scrollbar-thin::-webkit-scrollbar-track { background: #101010; }
        .scrollbar-thin::-webkit-scrollbar-thumb { background: #444; border-radius: 2px; }
      `}</style>
    </div>
  );
}
