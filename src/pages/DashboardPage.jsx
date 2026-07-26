import { useState, useEffect, useCallback } from 'react';
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
  if (hrs < 24) return `${hrs}h ${mins % 60}h ago`;
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
  const [notes, setNotes] = useState([]);
  const [noteLoading, setNoteLoading] = useState(false);
  const [noteSaving, setNoteSaving] = useState(false);
  const [showInfo, setShowInfo] = useState(false);
  const [screenshot, setScreenshot] = useState(null);
  const [refreshingScreenshot, setRefreshingScreenshot] = useState(false);

  const selectedDevice = devices.find(d => d.device_id === selectedDeviceId);

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
    const interval = setInterval(fetchDevices, 15000);
    return () => clearInterval(interval);
  }, [fetchDevices]);

  const fetchNotes = useCallback(async (deviceId) => {
    if (!deviceId) { setNotes([]); return; }
    setNoteLoading(true);
    try {
      const res = await axios.get(`${API_URL}/device-notes/${deviceId}`, { validateStatus: s => s === 200 || s === 404 });
      setNotes(res.status === 200 ? res.data.notes : []);
    } catch {
      setNotes([]);
    } finally {
      setNoteLoading(false);
    }
  }, []);

  useEffect(() => {
    if (selectedDeviceId) fetchNotes(selectedDeviceId);
    else { setNotes([]); setScreenshot(null); }
  }, [selectedDeviceId, fetchNotes]);

  useEffect(() => {
    if (selectedDeviceId && showInfo) {
      fetchScreenshot(selectedDeviceId);
    }
  }, [selectedDeviceId, showInfo]);

  const fetchScreenshot = async (deviceId) => {
    try {
      const r = await axios.get(`${API_URL}/device-screenshot/${deviceId}`, { validateStatus: s => s === 200 || s === 404 });
      setScreenshot(r.status === 200 ? r.data.image : null);
    } catch {
      setScreenshot(null);
    }
  };

  const handleRefreshScreenshot = async () => {
    if (!selectedDeviceId) return;
    setRefreshingScreenshot(true);
    try {
      await axios.post(`${API_URL}/device-screenshot/refresh/${selectedDeviceId}`);
      setTimeout(() => fetchScreenshot(selectedDeviceId), 2000);
    } catch { /* silent */ }
    finally { setTimeout(() => setRefreshingScreenshot(false), 2000); }
  };

  const handleAddNote = async () => {
    if (!selectedDeviceId || !noteText.trim()) return;
    setNoteSaving(true);
    try {
      await axios.post(`${API_URL}/device-notes`, { device_id: selectedDeviceId, note: noteText, author: 'admin' });
      setNoteText('');
      fetchNotes(selectedDeviceId);
    } catch { /* silent */ }
    finally { setNoteSaving(false); }
  };

  const handleDeleteNote = async (noteId) => {
    if (!selectedDeviceId) return;
    try {
      await axios.delete(`${API_URL}/device-notes/${selectedDeviceId}/${noteId}`);
      fetchNotes(selectedDeviceId);
    } catch { /* silent */ }
  };

  const handleConnect = (deviceId) => {
    window.location.href = `rdviewer://connect/${deviceId}`;
  };

  const sourceDevices = sessionFilter === 'active' ? activeDevices : devices;
  const filtered = sourceDevices.filter(d => {
    const q = searchQuery.toLowerCase();
    if (!q) return true;
    return d.device_name.toLowerCase().includes(q) || d.device_id.toLowerCase().includes(q) || (d.whoami && d.whoami.toLowerCase().includes(q));
  });
  const [noteSearchIds, setNoteSearchIds] = useState([]);
  const [sessionFilter, setSessionFilter] = useState('all');
  const activeDevices = devices.filter(d => d.status === 'online' || d.status === 'booting');
  useEffect(() => {
    if (!searchQuery.trim()) { setNoteSearchIds([]); return; }
    const timer = setTimeout(async () => {
      try {
        const res = await axios.get(`${API_URL}/device-notes/search/${encodeURIComponent(searchQuery)}`, { validateStatus: s => s === 200 || s === 404 });
        if (res.status === 200) setNoteSearchIds(res.data.results.map(r => r.device_id));
      } catch {}
    }, 300);
    return () => clearTimeout(timer);
  }, [searchQuery]);
  const searchResults = searchQuery ? [...new Set([...filtered.map(d => d.device_id), ...noteSearchIds])].map(id => devices.find(d => d.device_id === id)).filter(Boolean) : filtered;

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
        <div className={`flex items-center justify-between bg-[#252538] rounded px-3 py-2.5 cursor-pointer text-[#ddd] text-sm ${sessionFilter === 'all' ? 'ring-1 ring-[#00bcd4]' : ''}`} onClick={() => setSessionFilter('all')}>
          <span className="font-semibold">My Sessions</span>
          <span className="bg-[#444] text-[#ccc] rounded px-[7px] py-[2px] text-xs font-bold">{devices.length}</span>
        </div>
        <div className={`flex items-center justify-between bg-[#1a1a2e] rounded px-3 py-2.5 cursor-pointer text-[#ddd] text-sm ${sessionFilter === 'active' ? 'ring-1 ring-[#4caf50]' : ''}`} onClick={() => setSessionFilter('active')}>
          <span className="flex items-center gap-2"><span className="w-2 h-2 bg-[#4caf50] rounded-full"></span><span>Active Sessions</span></span>
          <span className="bg-[#4caf50] text-white rounded px-[7px] py-[2px] text-xs font-bold">{activeDevices.length}</span>
        </div>
        <div className="flex-1" />
        <div className="flex items-center gap-2 text-xs text-[#555] cursor-pointer hover:text-[#aaa]" onClick={() => { logout(); navigate('/login'); }}>
          <span>&#10140;</span>
          <span>Sign out</span>
        </div>
      </div>

      {/* ── MIDDLE PANEL (wider) ── */}
      <div className="w-[480px] min-w-[480px] bg-[#101010] flex flex-col border-r border-[#2a2a3e]">
        <div className="flex items-center justify-between px-4 py-3 border-b border-[#2a2a3e]">
          <h3 className="text-base font-bold text-white">My Sessions</h3>
          <div className="flex items-center gap-3 text-sm text-[#aaa]">
            <span className="flex items-center gap-1.5 cursor-pointer hover:text-white px-2 py-1 bg-[#252538] rounded" onClick={() => selectedDeviceId && handleConnect(selectedDeviceId)}>
              <span className="text-sm">&#9654;</span> Join
            </span>
            <span className="text-[#555] text-lg cursor-default font-bold">&#8943;</span>
          </div>
        </div>

        <div className="px-3 py-2.5 border-b border-[#2a2a3e]">
          <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[#666] text-sm">&#128269;</span>
            <input type="text" placeholder="Search My Sessions" value={searchQuery} onChange={e => setSearchQuery(e.target.value)}
              className="w-full bg-[#252538] border border-[#333348] rounded text-[#ccc] px-3 py-2 pl-[34px] text-sm outline-none placeholder:text-[#666]" />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto scrollbar-thin">
          {loading ? (
            <div className="text-center py-12 text-[#666] text-sm">Loading sessions...</div>
          ) : error && searchResults.length === 0 ? (
            <div className="text-center py-12 text-[#666] text-sm">{error}</div>
          ) : searchResults.length === 0 ? (
            <div className="text-center py-12 text-[#666] text-sm">No sessions found</div>
          ) : searchResults.map(d => {
            const isOnline = d.status === 'online' || d.status === 'booting';
            const isSelected = d.device_id === selectedDeviceId;
            return (
              <div key={d.device_id}
                className={`flex items-center px-3 py-2.5 border-b border-[#1a1a2e] cursor-pointer gap-3 transition-all hover:bg-[#1a1a2e] ${isSelected ? 'bg-[#1a1a2e] border-l-2 border-l-[#00bcd4]' : ''}`}
                onClick={() => setSelectedDeviceId(d.device_id)}
                onDoubleClick={() => handleConnect(d.device_id)}>
                <input type="checkbox" className="accent-[#555] w-4 h-4 shrink-0" checked={isSelected} onChange={() => setSelectedDeviceId(d.device_id)} onClick={e => e.stopPropagation()} />
                <div className="flex-1 min-w-0">
                  <div className="text-[#ddd] text-sm font-semibold truncate">{d.device_name}</div>
                  <div className="text-[#777] text-xs truncate">Host: {d.device_id}</div>
                  {d.whoami && <div className="text-[#777] text-xs truncate">User: {d.whoami} ({formatIdle(d.last_seen, isOnline)})</div>}
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {isOnline ? (
                    <span className="text-[#4caf50] text-xs font-semibold border border-[#4caf50] rounded px-[5px] py-[1px] whitespace-nowrap">Active</span>
                  ) : (
                    <span className="text-[#555] text-base">&#9679;</span>
                  )}
                  <span className="text-[#555] text-base cursor-pointer hover:text-[#aaa]">&#128100;</span>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* ── RIGHT PANEL (notes area — flex takes remaining space) ── */}
      <div className="flex-1 bg-[#002129] flex flex-col min-w-0 max-w-[calc(100%-220px-480px-36px)]">
        <div className="px-4 py-3 border-b border-[#2a2a3e] flex items-center justify-between">
          <h3 className="text-base font-bold text-white truncate">{selectedDevice ? selectedDevice.device_name : 'Select a session'}</h3>
          {selectedDevice && (
            <div className="flex items-center gap-2 text-sm text-[#888]">
              {showInfo && (
                <button onClick={() => { setShowInfo(false); setScreenshot(null); }} className="text-[#00bcd4] hover:text-[#00acc1] px-2 py-1 rounded bg-[#252538] transition-colors">&#10005; Close Info</button>
              )}
            </div>
          )}
        </div>

        {/* Info panel (toggled by "i" icon) */}
        {showInfo && selectedDevice && (
          <div className="border-b border-[#2a2a3e] bg-[#1c1c2c]">
            <div className="px-4 py-3 space-y-2">
              <div className="text-xs text-[#888]">
                <span className="text-[#aaa] font-semibold">ID:</span> {selectedDevice.device_id}
              </div>
              {selectedDevice.whoami && (
                <div className="text-xs text-[#888]">
                  <span className="text-[#aaa] font-semibold">User:</span> {selectedDevice.whoami}
                </div>
              )}
              {selectedDevice.host_ip && (
                <div className="text-xs text-[#888]">
                  <span className="text-[#aaa] font-semibold">IP:</span> {selectedDevice.host_ip}
                </div>
              )}
              <div className="text-xs text-[#888]">
                <span className="text-[#aaa] font-semibold">Status:</span>{' '}
                <span className={selectedDevice.status === 'online' || selectedDevice.status === 'booting' ? 'text-[#4caf50]' : 'text-[#555]'}>
                  {selectedDevice.status}
                </span>
              </div>
              <div className="text-xs text-[#888]">
                <span className="text-[#aaa] font-semibold">Last seen:</span> {formatTimeAgo(selectedDevice.last_seen) || 'Never'}
              </div>
              <div className="text-xs text-[#888]">
                <span className="text-[#aaa] font-semibold">Notes:</span> {notes.length}
              </div>
              {screenshot && (
                <div className="mt-2 relative bg-black rounded border border-[#333348] flex items-center justify-center" style={{ minHeight: '100px', maxHeight: '250px' }}>
                  <img src={screenshot} alt="Screenshot" className="w-full h-full rounded" style={{ objectFit: 'contain', maxHeight: '250px' }} />
                  {(selectedDevice.status === 'online' || selectedDevice.status === 'booting') && (
                    <button onClick={handleRefreshScreenshot} disabled={refreshingScreenshot}
                      className="absolute top-1 right-1 bg-black/60 hover:bg-black/80 text-white text-xs px-2 py-1 rounded transition-colors">
                      {refreshingScreenshot ? '...' : 'Refresh'}
                    </button>
                  )}
                </div>
              )}
              <button onClick={() => handleConnect(selectedDeviceId)}
                className="mt-2 w-full bg-[#00bcd4] text-white text-sm font-semibold py-2 rounded hover:bg-[#00acc1] transition-colors">
                &#9654; Join Session
              </button>
            </div>
          </div>
        )}

        <div className="flex-1 overflow-y-auto px-3 py-2 flex flex-col gap-1.5 scrollbar-thin">
          {!selectedDevice ? (
            <div className="text-center py-12 text-[#555] text-sm">Select a session to view details</div>
          ) : noteLoading ? (
            <div className="text-center py-8 text-[#555] text-sm">Loading notes...</div>
          ) : notes.length === 0 ? (
            <div className="text-center py-8 text-[#555] text-sm">No notes yet</div>
          ) : notes.map(n => (
            <div key={n.note_id} className="bg-[#393939] rounded px-3 py-2.5 border-b border-[#252538]">
              <div className="flex items-center justify-between mb-1">
                <div className="flex items-baseline gap-2">
                  <span className="text-xs font-semibold text-[#ccc]">{n.author}</span>
                  <span className="text-xs text-[#666]">{n.created_at ? formatTimeAgo(n.created_at) : ''} ago</span>
                </div>
                <button onClick={() => handleDeleteNote(n.note_id)} className="bg-none border-none text-[#555] cursor-pointer text-sm hover:text-[#e57373] transition-colors">&#128465;</button>
              </div>
              <div className="text-sm text-[#888] leading-relaxed whitespace-pre-wrap">{n.note}</div>
            </div>
          ))}
        </div>

        {selectedDevice && (
          <div className="px-3 py-2.5 border-t border-[#2a2a3e] flex gap-2 items-center">
            <textarea placeholder="Enter a note" value={noteText} onChange={e => setNoteText(e.target.value)}
              className="flex-1 bg-[#252538] border border-[#333348] rounded text-[#ccc] px-3 py-2 text-sm outline-none resize-none h-[42px] font-inherit placeholder:text-[#555]" />
            <button onClick={handleAddNote} disabled={noteSaving || !noteText.trim()}
              className="bg-[#00bcd4] text-white border-none rounded px-5 h-[42px] text-sm font-semibold cursor-pointer whitespace-nowrap hover:bg-[#00acc1] disabled:opacity-40 disabled:cursor-not-allowed transition-colors">
              {noteSaving ? '...' : 'Add Note'}
            </button>
          </div>
        )}
      </div>

      {/* ── FAR RIGHT ICON SIDEBAR ── */}
      <div className="w-[36px] min-w-[36px] bg-[#181826] border-l border-[#2a2a3e] flex flex-col items-center pt-3 gap-4">
        <span className="text-[#555] text-base cursor-pointer p-1 hover:text-[#aaa] transition-colors" title="Link">&#128279;</span>
        <span className={`text-base cursor-pointer p-1 transition-colors ${showInfo ? 'text-[#00bcd4]' : 'text-[#555] hover:text-[#aaa]'}`}
          title="Device Info" onClick={() => selectedDeviceId && setShowInfo(v => !v)}>&#9432;</span>
        <span className="text-[#555] text-base cursor-pointer p-1 hover:text-[#aaa] transition-colors" title="History">&#128336;</span>
        <span className="text-[#555] text-base cursor-pointer p-1 hover:text-[#aaa] transition-colors" title="Chat">&#128172;</span>
        <span className="text-[#00bcd4] text-base cursor-pointer p-1 transition-colors" title="Notes">&#128196;</span>
        <span className="text-[#555] text-base cursor-pointer p-1 hover:text-[#aaa] transition-colors" title="Settings">&#9881;</span>
      </div>

      <style>{`
        .scrollbar-thin::-webkit-scrollbar { width: 5px; }
        .scrollbar-thin::-webkit-scrollbar-track { background: #101010; }
        .scrollbar-thin::-webkit-scrollbar-thumb { background: #444; border-radius: 2px; }
      `}</style>
    </div>
  );
}
