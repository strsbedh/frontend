import { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { Monitor, Wifi, WifiOff, ArrowLeft, RefreshCw, PlugZap, Pencil, Check, X, Key, Eye, EyeOff, Search, Trash2, User, LogOut, Camera } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import axios from 'axios';
import { API_URL } from '../utils/webrtc';
import NotesModal from '../components/NotesModal';
import { Dialog, DialogContent } from '../components/ui/dialog';

function DeviceCard({ device, screenshot, cameraImage, onConnect, onNotesClick, onScreenshotClick, onRefreshScreenshot, onCameraCapture, onCameraImageClick, onRename, onCredentialClick, onDelete, hasViewerConnected }) {
  const isOnline = device.status === 'online' || device.status === 'booting';
  const [editing, setEditing] = useState(false);
  const [nameInput, setNameInput] = useState(device.device_name);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const inputRef = useRef(null);

  useEffect(() => { setNameInput(device.device_name); }, [device.device_name]);

  const startEdit = (e) => { e.stopPropagation(); setEditing(true); setTimeout(() => inputRef.current?.select(), 0); };
  const cancelEdit = () => { setEditing(false); setNameInput(device.device_name); };
  const saveEdit = async () => {
    const trimmed = nameInput.trim();
    if (!trimmed || trimmed === device.device_name) { cancelEdit(); return; }
    setSaving(true);
    try { await onRename(device.device_id, trimmed); setEditing(false); }
    catch { setNameInput(device.device_name); setEditing(false); }
    finally { setSaving(false); }
  };

  const handleDelete = async (e) => {
    e.stopPropagation();
    if (!window.confirm(`Delete "${device.device_name}"?`)) return;
    setDeleting(true);
    try { await onDelete(device.device_id); }
    catch { alert('Delete failed'); }
    finally { setDeleting(false); }
  };

  const handleKeyDown = (e) => { if (e.key === 'Enter') saveEdit(); if (e.key === 'Escape') cancelEdit(); };

  return (
    <div data-testid={`device-card-${device.device_id}`} className={`bg-white border group ${isOnline ? 'border-zinc-200 hover:shadow-md' : 'border-zinc-100 opacity-55'} rounded-xl overflow-hidden transition-all`}>
      <div data-testid={`screenshot-thumbnail-${device.device_id}`} className="relative w-full bg-zinc-100 cursor-pointer" style={{ paddingBottom: '56.25%' }} onClick={screenshot ? onScreenshotClick : undefined}>
        {screenshot ? (
          <img src={screenshot} alt="" className="absolute inset-0 w-full h-full object-cover" />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center"><Monitor className="w-10 h-10 text-zinc-300" strokeWidth={1} /></div>
        )}

        <button onClick={(e) => { e.stopPropagation(); onNotesClick(); }} data-testid={`notes-btn-${device.device_id}`} className="absolute bottom-2 left-2 w-7 h-7 bg-white/80 hover:bg-white rounded-lg border border-zinc-200 flex items-center justify-center text-sm opacity-0 group-hover:opacity-100 transition-opacity" title="Notes">📝</button>
        <button onClick={(e) => { e.stopPropagation(); onCredentialClick(); }} data-testid={`cred-btn-${device.device_id}`} className="absolute bottom-2 left-11 w-7 h-7 bg-white/80 hover:bg-white rounded-lg border border-zinc-200 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity" title="Credentials"><Key className="w-3.5 h-3.5 text-zinc-600" strokeWidth={1.5} /></button>

        {hasViewerConnected && (
          <div className="absolute top-2 left-2 w-7 h-7 bg-green-500 rounded-lg flex items-center justify-center"><User className="w-3.5 h-3.5 text-white" strokeWidth={1.5} /></div>
        )}
        <button onClick={handleDelete} disabled={deleting} data-testid={`delete-btn-${device.device_id}`} className="absolute top-2 right-2 w-7 h-7 bg-red-500/80 hover:bg-red-600 rounded-lg flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity" title="Delete"><Trash2 className="w-3.5 h-3.5 text-white" strokeWidth={1.5} /></button>
        {isOnline && onRefreshScreenshot && (
          <button onClick={(e) => { e.stopPropagation(); onRefreshScreenshot(); }} data-testid={`refresh-screenshot-btn-${device.device_id}`} className="absolute bottom-2 right-2 w-7 h-7 bg-white/80 hover:bg-white rounded-lg border border-zinc-200 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity" title="Refresh screenshot"><RefreshCw className="w-3.5 h-3.5 text-zinc-600" strokeWidth={1.5} /></button>
        )}
        {cameraImage && (
          <div className="absolute bottom-2 left-1/2 -translate-x-1/2 w-7 h-7 bg-green-500/80 rounded-lg flex items-center justify-center cursor-pointer hover:bg-green-500 transition-colors" onClick={(e) => { e.stopPropagation(); onCameraImageClick && onCameraImageClick(); }} title="Camera image">
            <Camera className="w-3.5 h-3.5 text-white" strokeWidth={1.5} />
          </div>
        )}
      </div>

      <div className="p-4">
        <div className="flex items-start justify-between gap-2 mb-1">
          {editing ? (
            <div className="flex items-center gap-1 flex-1 min-w-0">
              <input ref={inputRef} value={nameInput} onChange={e => setNameInput(e.target.value)} onKeyDown={handleKeyDown} disabled={saving} className="text-sm font-medium border border-blue-400 rounded px-1.5 py-0.5 flex-1 min-w-0 outline-none focus:ring-1 focus:ring-blue-400" maxLength={100} autoFocus />
              <button onClick={saveEdit} disabled={saving} className="text-green-600 hover:text-green-700 flex-shrink-0"><Check className="w-3.5 h-3.5" strokeWidth={2} /></button>
              <button onClick={cancelEdit} disabled={saving} className="text-zinc-400 hover:text-zinc-600 flex-shrink-0"><X className="w-3.5 h-3.5" strokeWidth={2} /></button>
            </div>
          ) : (
            <div className="flex items-center gap-1.5 flex-1 min-w-0">
              <span className="font-medium text-zinc-900 text-sm truncate">{device.device_name}</span>
              <button onClick={startEdit} className="text-zinc-300 hover:text-zinc-500 flex-shrink-0 opacity-0 group-hover:opacity-100"><Pencil className="w-3 h-3" strokeWidth={1.5} /></button>
            </div>
          )}
          <span className={`text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded shrink-0 ${isOnline ? 'bg-green-50 text-green-700 border border-green-200' : 'bg-zinc-50 text-zinc-400 border border-zinc-100'}`}>{device.status}</span>
        </div>

        {device.last_online_ago && (
          <div className={`text-[11px] mb-1 ${isOnline ? 'text-green-600' : 'text-zinc-400'}`}>
            {isOnline ? device.last_online_ago : `Last: ${device.last_online_ago}`}
          </div>
        )}
        <div className="font-mono text-[11px] text-zinc-400 mb-2">{device.device_id}</div>
        {device.whoami && (
          <div className="flex items-center gap-1 mb-3 text-[11px] text-zinc-500">
            <User className="w-3 h-3" strokeWidth={1.5} />
            <span>{device.whoami}</span>
          </div>
        )}

        {isOnline && onConnect && (
          <div className="flex gap-2">
            <button onClick={onConnect} data-testid={`connect-btn-${device.device_id}`} className="flex-1 bg-[#002FA7] hover:bg-[#001D66] text-white text-sm font-medium py-2 rounded-lg transition-colors flex items-center justify-center gap-1.5">
              <PlugZap className="w-3.5 h-3.5" strokeWidth={1.5} />
              Connect
            </button>
            <button onClick={(e) => { e.stopPropagation(); onCameraCapture(); }} data-testid={`camera-btn-${device.device_id}`} className="bg-zinc-800 hover:bg-zinc-900 text-white text-sm font-medium px-3 py-2 rounded-lg transition-colors" title="Capture camera">
              <Camera className="w-3.5 h-3.5" strokeWidth={1.5} />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

export default function DashboardPage() {
  const navigate = useNavigate();
  const { logout } = useAuth();
  const [devices, setDevices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [refreshing, setRefreshing] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [screenshots, setScreenshots] = useState({});
  const [cameraImages, setCameraImages] = useState({});
  const [viewerConnections, setViewerConnections] = useState({});
  const [showBanner, setShowBanner] = useState(!sessionStorage.getItem('viewer-agent-dismissed'));

  const [selectedDevice, setSelectedDevice] = useState(null);
  const [notesOpen, setNotesOpen] = useState(false);
  const [screenshotModal, setScreenshotModal] = useState(null);
  const [cameraModal, setCameraModal] = useState(null);
  const [credentialModal, setCredentialModal] = useState({ open: false, deviceId: null, deviceName: '' });
  const [credentialData, setCredentialData] = useState(null);
  const [credentialLoading, setCredentialLoading] = useState(false);
  const [showCredential, setShowCredential] = useState(false);

  const handleConnect = useCallback((deviceId) => { window.location.href = `rdviewer://connect/${deviceId}`; }, []);

  const fetchScreenshot = useCallback(async (deviceId) => {
    try {
      const res = await axios.get(`${API_URL}/device-screenshot/${deviceId}`, { validateStatus: s => s === 200 || s === 404 });
      return res.status === 200 ? res.data.image : null;
    } catch { return null; }
  }, []);

  const fetchCameraImage = useCallback(async (deviceId) => {
    try {
      const res = await axios.get(`${API_URL}/device-camera/${deviceId}`, { validateStatus: s => s === 200 || s === 404 });
      return res.status === 200 ? res.data.image : null;
    } catch { return null; }
  }, []);

  const fetchDevices = useCallback(async (showRefresh = false) => {
    if (showRefresh) setRefreshing(true);
    setError(null);
    try {
      const [devRes, healthRes] = await Promise.all([
        axios.get(`${API_URL}/devices`),
        axios.get(`${API_URL}/health`),
      ]);
      const list = devRes.data.devices || [];
      setDevices(list);

      const [screenshotResults, cameraResults] = await Promise.all([
        Promise.all(list.map(d => fetchScreenshot(d.device_id).then(img => ({ id: d.device_id, img })))),
        Promise.all(list.map(d => fetchCameraImage(d.device_id).then(img => ({ id: d.device_id, img })))),
      ]);
      setScreenshots(Object.fromEntries(screenshotResults.filter(r => r.img).map(r => [r.id, r.img])));
      setCameraImages(Object.fromEntries(cameraResults.filter(r => r.img).map(r => [r.id, r.img])));

      const conns = {};
      if (healthRes.data.viewer_connections) {
        Object.entries(healthRes.data.viewer_connections).forEach(([id, count]) => { conns[id] = count > 0; });
      }
      setViewerConnections(conns);
    } catch (err) {
      setError(err.response?.status === 503 ? 'Backend unavailable' : 'Failed to load devices');
      console.error('[dashboard] fetch failed:', err);
    }
    finally { setLoading(false); setRefreshing(false); }
  }, [fetchScreenshot, fetchCameraImage]);

  useEffect(() => {
    fetchDevices();
    const interval = setInterval(() => fetchDevices(), 15000);
    return () => clearInterval(interval);
  }, [fetchDevices]);

  const handleRename = useCallback(async (deviceId, newName) => {
    await axios.patch(`${API_URL}/devices/${deviceId}/rename`, { device_name: newName });
    setDevices(prev => prev.map(d => d.device_id === deviceId ? { ...d, device_name: newName } : d));
  }, []);

  const handleDelete = useCallback(async (deviceId) => {
    await axios.delete(`${API_URL}/devices/${deviceId}`);
    setDevices(prev => prev.filter(d => d.device_id !== deviceId));
    setScreenshots(prev => { const n = { ...prev }; delete n[deviceId]; return n; });
  }, []);

  const handleRefreshScreenshot = async (device) => {
    try {
      await axios.post(`${API_URL}/device-screenshot/refresh/${device.device_id}`);
      setTimeout(async () => {
        const img = await fetchScreenshot(device.device_id);
        if (img) setScreenshots(prev => ({ ...prev, [device.device_id]: img }));
      }, 2000);
    } catch { /* silent */ }
  };

  const handleCameraCapture = async (device) => {
    try {
      await axios.post(`${API_URL}/device-camera/capture/${device.device_id}`);
      setTimeout(async () => {
        const img = await fetchCameraImage(device.device_id);
        if (img) setCameraImages(prev => ({ ...prev, [device.device_id]: img }));
      }, 2000);
    } catch { /* silent */ }
  };

  const handleCredentialClick = useCallback(async (device) => {
    setCredentialModal({ open: true, deviceId: device.device_id, deviceName: device.device_name });
    setCredentialData(null);
    setShowCredential(false);
    setCredentialLoading(true);
    try {
      const res = await axios.get(`${API_URL}/device-credential/${device.device_id}`);
      setCredentialData(res.data);
    } catch { setCredentialData(null); }
    finally { setCredentialLoading(false); }
  }, []);

  const filtered = devices.filter(d => {
    const q = searchQuery.toLowerCase();
    return d.device_name.toLowerCase().includes(q) || d.device_id.toLowerCase().includes(q) || (d.whoami && d.whoami.toLowerCase().includes(q));
  });
  const onlineDevices = filtered.filter(d => d.status === 'online' || d.status === 'booting');
  const offlineDevices = filtered.filter(d => d.status !== 'online' && d.status !== 'booting');

  return (
    <div className="min-h-screen bg-zinc-50" data-testid="dashboard-page">
      {showBanner && (
        <div className="bg-blue-50 border-b border-blue-200 px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3 text-sm text-blue-800">
            <span>Install the <strong>Electron Viewer App</strong> for full Win key support (Win+R, Win+D, etc.)</span>
            <a href={process.env.REACT_APP_VIEWER_AGENT_DOWNLOAD_URL || '#'} target="_blank" rel="noopener noreferrer" className="underline font-medium hover:text-blue-900">Download</a>
          </div>
          <button onClick={() => { setShowBanner(false); sessionStorage.setItem('viewer-agent-dismissed', '1'); }} className="text-blue-500 hover:text-blue-700 text-lg leading-none">×</button>
        </div>
      )}

      <header className="bg-white/90 backdrop-blur-xl border-b border-zinc-200 sticky top-0 z-50">
        <div className="max-w-[1200px] mx-auto px-4 md:px-8 py-3 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <button onClick={() => navigate('/')} className="text-zinc-400 hover:text-zinc-700 transition-colors"><ArrowLeft className="w-5 h-5" strokeWidth={1.5} /></button>
            <div className="flex items-center gap-2">
              <Monitor className="w-5 h-5 text-[#002FA7]" strokeWidth={1.5} />
              <span className="font-bold text-zinc-950 text-lg">Devices</span>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-400" strokeWidth={1.5} />
              <input type="text" placeholder="Search..." value={searchQuery} onChange={e => setSearchQuery(e.target.value)} data-testid="search-input" className="pl-10 pr-4 py-2 text-sm border border-zinc-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent w-48 md:w-64" />
            </div>
            <button onClick={() => fetchDevices(true)} data-testid="refresh-btn" className="text-zinc-500 hover:text-zinc-700 transition-colors p-1"><RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} strokeWidth={1.5} /></button>
            <button onClick={() => { logout(); navigate('/login'); }} className="text-zinc-400 hover:text-red-500 transition-colors p-1" title="Sign out"><LogOut className="w-4 h-4" strokeWidth={1.5} /></button>
          </div>
        </div>
      </header>

      <main className="max-w-[1200px] mx-auto p-4 md:p-8">
        {loading ? (
          <div className="text-center py-16 text-zinc-400 text-sm">Loading devices...</div>
        ) : error && devices.length === 0 ? (
          <div className="text-center py-16">
            <Monitor className="w-10 h-10 text-zinc-300 mx-auto mb-3" strokeWidth={1} />
            <p className="text-zinc-500 text-sm mb-2">{error}</p>
            <button onClick={() => fetchDevices(true)} className="text-sm text-[#002FA7] hover:underline">Retry</button>
          </div>
        ) : filtered.length === 0 && searchQuery ? (
          <div className="text-center py-16"><Search className="w-10 h-10 text-zinc-300 mx-auto mb-3" strokeWidth={1} /><p className="text-zinc-500 text-sm">No devices match your search</p></div>
        ) : devices.length === 0 ? (
          <div className="text-center py-16"><Monitor className="w-10 h-10 text-zinc-300 mx-auto mb-3" strokeWidth={1} /><p className="text-zinc-500 text-sm">No devices registered</p></div>
        ) : (
          <div className="space-y-8">
            {onlineDevices.length > 0 && (
              <section>
                <div className="flex items-center gap-2 mb-4">
                  <div className="w-2 h-2 bg-green-500 rounded-full" />
                  <span className="text-xs font-bold uppercase tracking-widest text-zinc-500">Online ({onlineDevices.length})</span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                  {onlineDevices.map(d => (
                    <DeviceCard key={d.device_id} device={d} screenshot={screenshots[d.device_id]} cameraImage={cameraImages[d.device_id]}
                      onConnect={() => handleConnect(d.device_id)} onNotesClick={() => { setSelectedDevice(d); setNotesOpen(true); }}
                      onScreenshotClick={() => { const s = screenshots[d.device_id]; if (s) setScreenshotModal({ image: s, name: d.device_name }); }}
                      onRefreshScreenshot={() => handleRefreshScreenshot(d)} onCameraCapture={() => handleCameraCapture(d)}
                      onCameraImageClick={() => { const c = cameraImages[d.device_id]; if (c) setCameraModal({ image: c, name: d.device_name }); }}
                      onRename={handleRename} onCredentialClick={() => handleCredentialClick(d)} onDelete={handleDelete}
                      hasViewerConnected={viewerConnections[d.device_id] || false} />
                  ))}
                </div>
              </section>
            )}
            {offlineDevices.length > 0 && (
              <section>
                <div className="flex items-center gap-2 mb-4">
                  <div className="w-2 h-2 bg-zinc-300 rounded-full" />
                  <span className="text-xs font-bold uppercase tracking-widest text-zinc-500">Offline ({offlineDevices.length})</span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                  {offlineDevices.map(d => (
                    <DeviceCard key={d.device_id} device={d} screenshot={screenshots[d.device_id]} cameraImage={cameraImages[d.device_id]}
                      onNotesClick={() => { setSelectedDevice(d); setNotesOpen(true); }}
                      onScreenshotClick={() => { const s = screenshots[d.device_id]; if (s) setScreenshotModal({ image: s, name: d.device_name }); }}
                      onCameraImageClick={() => { const c = cameraImages[d.device_id]; if (c) setCameraModal({ image: c, name: d.device_name }); }}
                      onRename={handleRename} onCredentialClick={() => handleCredentialClick(d)} onDelete={handleDelete}
                      hasViewerConnected={viewerConnections[d.device_id] || false} />
                  ))}
                </div>
              </section>
            )}
            {error && <p className="text-center text-xs text-red-400">{error} — data may be stale</p>}
          </div>
        )}
      </main>

      {selectedDevice && <NotesModal deviceId={selectedDevice.device_id} deviceName={selectedDevice.device_name} open={notesOpen} onClose={() => { setNotesOpen(false); setSelectedDevice(null); }} />}

      {screenshotModal && (
        <Dialog open={!!screenshotModal} onOpenChange={() => setScreenshotModal(null)}>
          <DialogContent className="max-w-5xl"><img src={screenshotModal.image} alt={screenshotModal.name} className="w-full h-auto" /></DialogContent>
        </Dialog>
      )}

      {cameraModal && (
        <Dialog open={!!cameraModal} onOpenChange={() => setCameraModal(null)}>
          <DialogContent className="max-w-3xl"><img src={cameraModal.image} alt={cameraModal.name} className="w-full h-auto" /></DialogContent>
        </Dialog>
      )}

      {credentialModal.open && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-sm p-6">
            <div className="flex items-center gap-3 mb-4">
              <Key className="w-5 h-5 text-zinc-600" strokeWidth={1.5} />
              <h2 className="font-semibold text-zinc-900">Saved Credentials</h2>
            </div>
            <p className="text-xs text-zinc-500 mb-4">{credentialModal.deviceName}</p>
            {credentialLoading ? (
              <p className="text-sm text-zinc-400">Loading...</p>
            ) : credentialData ? (
              <div className="space-y-3">
                <div><label className="text-xs text-zinc-500 block mb-1">Username</label><p className="text-sm font-mono bg-zinc-50 border border-zinc-200 rounded-lg px-3 py-2">{credentialData.username || '—'}</p></div>
                <div><label className="text-xs text-zinc-500 block mb-1">Password / PIN</label>
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-mono bg-zinc-50 border border-zinc-200 rounded-lg px-3 py-2 flex-1">{showCredential ? credentialData.credential : '••••••••'}</p>
                    <button onClick={() => setShowCredential(v => !v)} className="text-zinc-400 hover:text-zinc-700"><EyeOff className="w-4 h-4" /></button>
                  </div>
                </div>
                <p className="text-xs text-zinc-400">Saved: {new Date(credentialData.updated_at).toLocaleString()}</p>
              </div>
            ) : (
              <p className="text-sm text-zinc-400">No credentials saved yet.<br/>Use the viewer agent to request them from the host.</p>
            )}
            <button onClick={() => setCredentialModal({ open: false, deviceId: null, deviceName: '' })} className="mt-5 w-full text-sm text-zinc-500 hover:text-zinc-700 border border-zinc-200 rounded-lg py-2 transition-colors">Close</button>
          </div>
        </div>
      )}
    </div>
  );
}
