import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { MonitorSmartphone, Wifi, WifiOff, ArrowLeft, RefreshCw, PlugZap, Monitor, Pencil, Check, X, Key, Eye, EyeOff, Search, Trash2, User, LogOut } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import axios from 'axios';
import { API_URL } from '../utils/webrtc';
import NotesModal from '../components/NotesModal';
import { Dialog, DialogContent } from '../components/ui/dialog';

function DeviceCard({ device, onConnect, screenshot, cameraImage, onNotesClick, onScreenshotClick, onRefreshScreenshot, onCameraCapture, onCameraImageClick, onRename, onCredentialClick, onDelete, hasViewerConnected }) {
  const isOnline = device.status === 'online';
  const [editing, setEditing] = useState(false);
  const [nameInput, setNameInput] = useState(device.device_name);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const inputRef = useRef(null);

  // Sync if device name changes externally
  useEffect(() => { setNameInput(device.device_name); }, [device.device_name]);

  const startEdit = (e) => {
    e.stopPropagation();
    setEditing(true);
    setTimeout(() => inputRef.current?.select(), 0);
  };

  const cancelEdit = () => {
    setEditing(false);
    setNameInput(device.device_name);
  };

  const saveEdit = async () => {
    const trimmed = nameInput.trim();
    if (!trimmed || trimmed === device.device_name) { cancelEdit(); return; }
    setSaving(true);
    try {
      await onRename(device.device_id, trimmed);
      setEditing(false);
    } catch {
      setNameInput(device.device_name);
      setEditing(false);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (e) => {
    e.stopPropagation();
    if (!window.confirm(`Delete device "${device.device_name}"? This action cannot be undone.`)) return;
    setDeleting(true);
    try {
      await onDelete(device.device_id);
    } catch (err) {
      console.error('Failed to delete device:', err);
      alert('Failed to delete device. Please try again.');
    } finally {
      setDeleting(false);
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter') saveEdit();
    if (e.key === 'Escape') cancelEdit();
  };

  return (
    <div
      className={`bg-white border group ${isOnline ? 'border-zinc-200 hover:border-zinc-300' : 'border-zinc-100 opacity-60'} overflow-hidden transition-all`}
      data-testid={`device-card-${device.device_id}`}
    >
      {/* Screenshot Thumbnail */}
      <div 
        className="relative w-full bg-zinc-100 cursor-pointer hover:opacity-90 transition-opacity" 
        style={{ paddingBottom: '56.25%' }}
        onClick={screenshot ? onScreenshotClick : undefined}
        data-testid={`screenshot-thumbnail-${device.device_id}`}
      >
        {screenshot ? (
          <img
            src={screenshot}
            alt={`${device.device_name} screenshot`}
            className="absolute inset-0 w-full h-full object-cover"
          />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center">
            <Monitor className="w-12 h-12 text-zinc-300" strokeWidth={1} />
          </div>
        )}
        
        {/* Notes Icon Button - Bottom Left */}
        <button
          onClick={(e) => {
            e.stopPropagation();
            onNotesClick();
          }}
          className="absolute bottom-2 left-2 w-8 h-8 bg-white/90 hover:bg-white border border-zinc-200 hover:border-zinc-300 flex items-center justify-center transition-all shadow-sm hover:shadow"
          data-testid={`notes-btn-${device.device_id}`}
          title="View notes"
        >
          <span className="text-base">📝</span>
        </button>

        {/* Credentials Icon Button - Bottom Left (next to notes) */}
        <button
          onClick={(e) => {
            e.stopPropagation();
            onCredentialClick && onCredentialClick();
          }}
          className="absolute bottom-2 left-12 w-8 h-8 bg-white/90 hover:bg-white border border-zinc-200 hover:border-zinc-300 flex items-center justify-center transition-all shadow-sm hover:shadow"
          data-testid={`cred-btn-${device.device_id}`}
          title="View saved credentials"
        >
          <Key className="w-4 h-4 text-zinc-600" strokeWidth={1.5} />
        </button>

        {/* Viewer Connected Indicator - Top Left */}
        {hasViewerConnected && (
          <div
            className="absolute top-2 left-2 w-8 h-8 bg-green-500/90 border border-green-400 flex items-center justify-center shadow-sm"
            title="Viewer connected"
          >
            <User className="w-4 h-4 text-white" strokeWidth={1.5} />
          </div>
        )}

        {/* Delete Button - Top Right */}
        <button
          onClick={handleDelete}
          disabled={deleting}
          className="absolute top-2 right-2 w-8 h-8 bg-red-500/90 hover:bg-red-600/90 border border-red-400 hover:border-red-500 flex items-center justify-center transition-all shadow-sm hover:shadow opacity-0 group-hover:opacity-100"
          data-testid={`delete-btn-${device.device_id}`}
          title="Delete device"
        >
          <Trash2 className="w-4 h-4 text-white" strokeWidth={1.5} />
        </button>
        
        {/* Refresh Screenshot Button - Bottom Right (only for online devices) */}
        {isOnline && onRefreshScreenshot && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onRefreshScreenshot();
            }}
            className="absolute bottom-2 right-2 w-8 h-8 bg-white/90 hover:bg-white border border-zinc-200 hover:border-zinc-300 flex items-center justify-center transition-all shadow-sm hover:shadow"
            data-testid={`refresh-screenshot-btn-${device.device_id}`}
            title="Refresh screenshot now"
          >
            <RefreshCw className="w-4 h-4 text-zinc-600" strokeWidth={1.5} />
          </button>
        )}
        
        {/* Camera Image Indicator - Bottom Center (only when camera image available) */}
        {cameraImage && (
          <div
            className="absolute bottom-2 left-1/2 -translate-x-1/2 w-8 h-8 bg-green-500/90 border border-green-400 flex items-center justify-center shadow-sm cursor-pointer hover:bg-green-500 transition-colors"
            onClick={(e) => {
              e.stopPropagation();
              onCameraImageClick && onCameraImageClick();
            }}
            data-testid={`camera-indicator-${device.device_id}`}
            title="View camera image"
          >
            <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="m15.75 10.5 4.72-4.72a.75.75 0 0 1 1.28.53v11.38a.75.75 0 0 1-1.28.53l-4.72-4.72M4.5 18.75h9a2.25 2.25 0 0 0 2.25-2.25v-9a2.25 2.25 0 0 0-2.25-2.25h-9A2.25 2.25 0 0 0 2.25 7.5v9a2.25 2.25 0 0 0 2.25 2.25Z" />
            </svg>
          </div>
        )}
      </div>

      {/* Device Info */}
      <div className="p-5">
        <div className="flex items-start justify-between mb-3">
          <div className="flex items-center gap-2 flex-1 min-w-0">
            {isOnline ? (
              <Wifi className="w-4 h-4 text-green-500 flex-shrink-0" strokeWidth={1.5} />
            ) : (
              <WifiOff className="w-4 h-4 text-zinc-300 flex-shrink-0" strokeWidth={1.5} />
            )}
            {editing ? (
              <div className="flex items-center gap-1 flex-1 min-w-0">
                <input
                  ref={inputRef}
                  value={nameInput}
                  onChange={e => setNameInput(e.target.value)}
                  onKeyDown={handleKeyDown}
                  disabled={saving}
                  className="text-sm font-medium text-zinc-900 border border-blue-400 rounded px-1.5 py-0.5 flex-1 min-w-0 outline-none focus:ring-1 focus:ring-blue-400"
                  maxLength={100}
                  autoFocus
                />
                <button onClick={saveEdit} disabled={saving} className="text-green-600 hover:text-green-700 flex-shrink-0" title="Save">
                  <Check className="w-3.5 h-3.5" strokeWidth={2} />
                </button>
                <button onClick={cancelEdit} disabled={saving} className="text-zinc-400 hover:text-zinc-600 flex-shrink-0" title="Cancel">
                  <X className="w-3.5 h-3.5" strokeWidth={2} />
                </button>
              </div>
            ) : (
              <div className="flex items-center gap-1.5 flex-1 min-w-0">
                <span className="font-medium text-zinc-900 text-sm truncate">{device.device_name}</span>
                <button
                  onClick={startEdit}
                  className="text-zinc-300 hover:text-zinc-500 transition-colors flex-shrink-0 opacity-0 group-hover:opacity-100"
                  title="Rename device"
                >
                  <Pencil className="w-3 h-3" strokeWidth={1.5} />
                </button>
              </div>
            )}
          </div>
          <span
            className={`text-[10px] font-mono font-bold uppercase tracking-wider px-1.5 py-0.5 ${
              isOnline
                ? 'bg-green-50 text-green-700 border border-green-200'
                : 'bg-zinc-50 text-zinc-400 border border-zinc-100'
            }`}
          >
            {device.status}
          </span>
        </div>

        {/* Last Seen Display */}
        {device.last_online_ago && (
          <div className={`text-xs mb-2 ${isOnline ? 'text-green-600' : 'text-zinc-500'}`}>
            {isOnline ? device.last_online_ago : `Last seen: ${device.last_online_ago}`}
          </div>
        )}

        <div className="font-mono text-xs text-zinc-400 mb-4">{device.device_id}</div>

        {isOnline && onConnect && (
          <div className="flex gap-2">
            <button
              onClick={onConnect}
              className="flex-1 bg-[#002FA7] hover:bg-[#001D66] text-white text-sm font-medium px-4 py-2 transition-colors flex items-center justify-center gap-2"
              data-testid={`connect-btn-${device.device_id}`}
            >
              <PlugZap className="w-3.5 h-3.5" strokeWidth={1.5} />
              Connect
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation();
                onCameraCapture();
              }}
              className="bg-zinc-800 hover:bg-zinc-900 text-white text-sm font-medium px-3 py-2 transition-colors flex items-center justify-center gap-1.5"
              data-testid={`camera-btn-${device.device_id}`}
              title="Capture camera"
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="m15.75 10.5 4.72-4.72a.75.75 0 0 1 1.28.53v11.38a.75.75 0 0 1-1.28.53l-4.72-4.72M4.5 18.75h9a2.25 2.25 0 0 0 2.25-2.25v-9a2.25 2.25 0 0 0-2.25-2.25h-9A2.25 2.25 0 0 0 2.25 7.5v9a2.25 2.25 0 0 0 2.25 2.25Z" />
              </svg>
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
  const [refreshing, setRefreshing] = useState(false);
  const [screenshots, setScreenshots] = useState({});
  const [cameraImages, setCameraImages] = useState({});
  const [selectedDevice, setSelectedDevice] = useState(null);
  const [notesModalOpen, setNotesModalOpen] = useState(false);
  const [screenshotModalOpen, setScreenshotModalOpen] = useState(false);
  const [selectedScreenshot, setSelectedScreenshot] = useState(null);
  const [cameraModalOpen, setCameraModalOpen] = useState(false);
  const [selectedCameraImage, setSelectedCameraImage] = useState(null);
  const [showViewerBanner, setShowViewerBanner] = useState(false);
  const [credentialModal, setCredentialModal] = useState({ open: false, deviceId: null, deviceName: '' });
  const [credentialData, setCredentialData] = useState(null);
  const [credentialLoading, setCredentialLoading] = useState(false);
  const [showCredential, setShowCredential] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [viewerConnections, setViewerConnections] = useState({});

  // Launch Electron viewer app via rdviewer:// protocol — no browser fallback
  const handleConnect = useCallback((deviceId) => {
    window.location.href = `rdviewer://connect/${deviceId}`;
  }, []);

  // Launch Electron camera viewer app via rdcam:// protocol
  const handleCameraConnect = useCallback((deviceId, hostIp) => {
    const url = hostIp
      ? `rdcam://connect/${deviceId}?host=${encodeURIComponent(hostIp)}&port=9211`
      : `rdcam://connect/${deviceId}?port=9211`;
    window.location.href = url;
  }, []);

  const fetchScreenshot = useCallback(async (deviceId) => {
    try {
      const res = await axios.get(`${API_URL}/device-screenshot/${deviceId}`, {
        // Suppress 404 errors in console (expected when screenshot doesn't exist yet)
        validateStatus: (status) => status === 200 || status === 404
      });
      
      if (res.status === 404) {
        // No screenshot exists yet - use placeholder
        return null;
      }
      
      return res.data.image;
    } catch (err) {
      // Only log unexpected errors (not 404)
      if (err.response?.status !== 404) {
        console.error(`Failed to fetch screenshot for ${deviceId}:`, err);
      }
      return null;
    }
  }, []);

  const fetchCameraImage = useCallback(async (deviceId) => {
    try {
      const res = await axios.get(`${API_URL}/device-camera/${deviceId}`, {
        validateStatus: (status) => status === 200 || status === 404
      });
      if (res.status === 404) {
        return null;
      }
      return res.data.image;
    } catch (err) {
      if (err.response?.status !== 404) {
        console.error(`Failed to fetch camera image for ${deviceId}:`, err);
      }
      return null;
    }
  }, []);

  const fetchScreenshots = useCallback(async (deviceList) => {
    // Fetch screenshots for ALL devices (both online and offline)
    const screenshotPromises = deviceList.map(async (device) => {
      const image = await fetchScreenshot(device.device_id);
      return { deviceId: device.device_id, image };
    });

    const results = await Promise.all(screenshotPromises);
    const screenshotMap = {};
    results.forEach(({ deviceId, image }) => {
      if (image) {
        screenshotMap[deviceId] = image;
      }
    });

    setScreenshots(screenshotMap);
  }, [fetchScreenshot]);

  const fetchCameraImages = useCallback(async (deviceList) => {
    const cameraPromises = deviceList.map(async (device) => {
      const image = await fetchCameraImage(device.device_id);
      return { deviceId: device.device_id, image };
    });

    const results = await Promise.all(cameraPromises);
    const cameraMap = {};
    results.forEach(({ deviceId, image }) => {
      if (image) {
        cameraMap[deviceId] = image;
      }
    });

    setCameraImages(cameraMap);
  }, [fetchCameraImage]);

  const fetchDevices = useCallback(async (showRefresh = false) => {
    if (showRefresh) setRefreshing(true);
    try {
      const res = await axios.get(`${API_URL}/devices`);
      const deviceList = res.data.devices || [];
      setDevices(deviceList);
      
      // Fetch screenshots for online devices
      await fetchScreenshots(deviceList);

      // Fetch camera images for all devices
      await fetchCameraImages(deviceList);
      
      // Fetch viewer connection status
      const statusRes = await axios.get(`${API_URL}/health`);
      const connections = {};
      if (statusRes.data.viewer_connections) {
        Object.keys(statusRes.data.viewer_connections).forEach(deviceId => {
          connections[deviceId] = statusRes.data.viewer_connections[deviceId] > 0;
        });
      }
      setViewerConnections(connections);
    } catch {
      // silent
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [fetchScreenshots, fetchCameraImages]);

  useEffect(() => {
    fetchDevices();
    const interval = setInterval(() => fetchDevices(), 10000); // Refresh every 10 seconds
    return () => clearInterval(interval);
  }, [fetchDevices]);

  const handleNotesClick = (device) => {
    setSelectedDevice(device);
    setNotesModalOpen(true);
  };

  const handleNotesClose = () => {
    setNotesModalOpen(false);
    setSelectedDevice(null);
  };

  const handleScreenshotClick = (device) => {
    const screenshot = screenshots[device.device_id];
    if (screenshot) {
      setSelectedScreenshot({ image: screenshot, deviceName: device.device_name });
      setScreenshotModalOpen(true);
    }
  };

  const handleScreenshotModalClose = () => {
    setScreenshotModalOpen(false);
    setSelectedScreenshot(null);
  };

  const handleCredentialClick = useCallback(async (device) => {
    setCredentialModal({ open: true, deviceId: device.device_id, deviceName: device.device_name });
    setCredentialData(null);
    setShowCredential(false);
    setCredentialLoading(true);
    try {
      const res = await axios.get(`${API_URL}/device-credential/${device.device_id}`);
      setCredentialData(res.data);
    } catch (err) {
      if (err.response?.status === 404) {
        setCredentialData(null);
      }
    } finally {
      setCredentialLoading(false);
    }
  }, []);

  const handleRename = useCallback(async (deviceId, newName) => {
    await axios.patch(`${API_URL}/devices/${deviceId}/rename`, { device_name: newName });
    // Update local state immediately
    setDevices(prev => prev.map(d =>
      d.device_id === deviceId ? { ...d, device_name: newName } : d
    ));
  }, []);

  const handleDelete = useCallback(async (deviceId) => {
    await axios.delete(`${API_URL}/devices/${deviceId}`);
    // Remove from local state immediately
    setDevices(prev => prev.filter(d => d.device_id !== deviceId));
    // Also remove screenshot
    setScreenshots(prev => {
      const newScreenshots = { ...prev };
      delete newScreenshots[deviceId];
      return newScreenshots;
    });
  }, []);

  const handleRefreshScreenshot = async (device) => {
    try {
      console.log(`[dashboard] 📸 Triggering manual screenshot refresh for ${device.device_id}`);
      await axios.post(`${API_URL}/device-screenshot/refresh/${device.device_id}`);
      
      // Wait 2 seconds for screenshot to be captured and uploaded
      setTimeout(async () => {
        const image = await fetchScreenshot(device.device_id);
        if (image) {
          setScreenshots(prev => ({ ...prev, [device.device_id]: image }));
          console.log(`[dashboard] ✅ Screenshot refreshed for ${device.device_id}`);
        }
      }, 2000);
    } catch (err) {
      console.error(`[dashboard] ❌ Failed to refresh screenshot for ${device.device_id}:`, err);
      if (err.response?.status === 503) {
        console.warn('[dashboard] Device is offline');
      }
    }
  };

  const handleCameraCapture = async (device) => {
    try {
      console.log(`[dashboard] 📷 Triggering camera capture for ${device.device_id}`);
      await axios.post(`${API_URL}/device-camera/capture/${device.device_id}`);

      // Wait 2 seconds for camera frame to be captured and uploaded
      setTimeout(async () => {
        const image = await fetchCameraImage(device.device_id);
        if (image) {
          setCameraImages(prev => ({ ...prev, [device.device_id]: image }));
          console.log(`[dashboard] ✅ Camera image received for ${device.device_id}`);
        }
      }, 2000);
    } catch (err) {
      console.error(`[dashboard] ❌ Failed to capture camera for ${device.device_id}:`, err);
      if (err.response?.status === 503) {
        console.warn('[dashboard] Device is offline');
      }
    }
  };

  const handleCameraImageClick = (device) => {
    const image = cameraImages[device.device_id];
    if (image) {
      setSelectedCameraImage({ image, deviceName: device.device_name });
      setCameraModalOpen(true);
    }
  };

  const handleCameraModalClose = () => {
    setCameraModalOpen(false);
    setSelectedCameraImage(null);
  };

  // Filter devices based on search query
  const filteredDevices = devices.filter(device => 
    device.device_name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    device.device_id.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const onlineDevices = filteredDevices.filter(d => d.status === 'online');
  const offlineDevices = filteredDevices.filter(d => d.status === 'offline');

  return (
    <div className="min-h-screen bg-zinc-50" data-testid="dashboard-page">
      {/* Viewer Agent download banner */}
      {showViewerBanner && (
        <div className="bg-blue-50 border-b border-blue-200 px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3 text-sm text-blue-800">
            <span>💡 Install the <strong>Electron Viewer App</strong> for full Win key support (Win+R, Win+D, etc.)</span>
            <a
              href={process.env.REACT_APP_VIEWER_AGENT_DOWNLOAD_URL || '#'}
              target="_blank"
              rel="noopener noreferrer"
              className="underline font-medium hover:text-blue-900"
            >
              Download
            </a>
          </div>
          <button
            onClick={() => { setShowViewerBanner(false); sessionStorage.setItem('viewer-agent-dismissed', '1'); }}
            className="text-blue-500 hover:text-blue-700 text-lg leading-none"
          >
            ×
          </button>
        </div>
      )}
      {/* Header */}
      <header className="bg-white/90 backdrop-blur-xl border-b border-zinc-200 sticky top-0 z-50">
        <div className="max-w-[1200px] mx-auto px-4 md:px-8 py-3 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <button
              onClick={() => navigate('/')}
              className="text-zinc-400 hover:text-zinc-700 transition-colors"
              data-testid="back-btn"
            >
              <ArrowLeft className="w-5 h-5" strokeWidth={1.5} />
            </button>
            <div className="flex items-center gap-2">
              <MonitorSmartphone className="w-5 h-5 text-[#002FA7]" strokeWidth={1.5} />
              <span className="font-heading font-bold text-zinc-950">Devices</span>
            </div>
          </div>
          <div className="flex items-center gap-3">
            {/* Search Input */}
            <div className="relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-zinc-400" strokeWidth={1.5} />
              <input
                type="text"
                placeholder="Search devices..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-10 pr-4 py-2 text-sm border border-zinc-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent w-64"
                data-testid="search-input"
              />
            </div>
            <button
              onClick={() => fetchDevices(true)}
              className="flex items-center gap-2 text-sm text-zinc-500 hover:text-zinc-700 transition-colors"
              data-testid="refresh-btn"
            >
              <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} strokeWidth={1.5} />
              Refresh
            </button>
            <button
              onClick={() => { logout(); navigate('/login'); }}
              className="flex items-center gap-1.5 text-sm text-zinc-400 hover:text-red-500 transition-colors"
              title="Sign out"
            >
              <LogOut className="w-4 h-4" strokeWidth={1.5} />
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-[1200px] mx-auto p-4 md:p-8">
        {loading ? (
          <div className="text-center py-16 text-zinc-400 text-sm">Loading devices...</div>
        ) : filteredDevices.length === 0 && searchQuery ? (
          <div className="text-center py-16">
            <Search className="w-12 h-12 text-zinc-300 mx-auto mb-4" strokeWidth={1} />
            <p className="text-zinc-500 text-sm mb-1">No devices found</p>
            <p className="text-zinc-400 text-xs">Try adjusting your search query</p>
          </div>
        ) : devices.length === 0 ? (
          <div className="text-center py-16">
            <MonitorSmartphone className="w-12 h-12 text-zinc-300 mx-auto mb-4" strokeWidth={1} />
            <p className="text-zinc-500 text-sm mb-1">No devices registered</p>
            <p className="text-zinc-400 text-xs">Register a host device to get started</p>
          </div>
        ) : (
          <div className="space-y-8">
            {onlineDevices.length > 0 && (
              <div>
                <div className="flex items-center gap-2 mb-4">
                  <div className="w-2 h-2 bg-green-500 rounded-full" />
                  <span className="text-xs font-bold uppercase tracking-[0.2em] text-zinc-500">
                    Online ({onlineDevices.length})
                  </span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                  {onlineDevices.map(device => (
                    <DeviceCard
                      key={device.device_id}
                      device={device}
                      screenshot={screenshots[device.device_id]}
                      cameraImage={cameraImages[device.device_id]}
                      onConnect={() => handleConnect(device.device_id)}
                      onNotesClick={() => handleNotesClick(device)}
                      onScreenshotClick={() => handleScreenshotClick(device)}
                      onRefreshScreenshot={() => handleRefreshScreenshot(device)}
                      onCameraCapture={() => handleCameraCapture(device)}
                      onCameraImageClick={() => handleCameraImageClick(device)}
                      onRename={handleRename}
                      onCredentialClick={() => handleCredentialClick(device)}
                      onDelete={handleDelete}
                      hasViewerConnected={viewerConnections[device.device_id] || false}
                    />
                  ))}
                </div>
              </div>
            )}

            {offlineDevices.length > 0 && (
              <div>
                <div className="flex items-center gap-2 mb-4">
                  <div className="w-2 h-2 bg-zinc-300 rounded-full" />
                  <span className="text-xs font-bold uppercase tracking-[0.2em] text-zinc-500">
                    Offline ({offlineDevices.length})
                  </span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                  {offlineDevices.map(device => (
                    <DeviceCard 
                      key={device.device_id} 
                      device={device}
                      screenshot={screenshots[device.device_id]}
                      onNotesClick={() => handleNotesClick(device)}
                      onScreenshotClick={() => handleScreenshotClick(device)}
                      onRename={handleRename}
                      onCredentialClick={() => handleCredentialClick(device)}
                      onDelete={handleDelete}
                      hasViewerConnected={viewerConnections[device.device_id] || false}
                    />
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </main>

      {/* Credential Modal */}
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
                <div>
                  <label className="text-xs text-zinc-500 block mb-1">Username</label>
                  <p className="text-sm font-mono bg-zinc-50 border border-zinc-200 rounded px-3 py-2">{credentialData.username || '—'}</p>
                </div>
                <div>
                  <label className="text-xs text-zinc-500 block mb-1">Password / PIN</label>
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-mono bg-zinc-50 border border-zinc-200 rounded px-3 py-2 flex-1">
                      {showCredential ? credentialData.credential : '••••••••'}
                    </p>
                    <button onClick={() => setShowCredential(v => !v)} className="text-zinc-400 hover:text-zinc-700">
                      {showCredential ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>
                <p className="text-xs text-zinc-400">Saved: {new Date(credentialData.updated_at).toLocaleString()}</p>
              </div>
            ) : (
              <p className="text-sm text-zinc-400">No credentials saved for this device yet.<br/>Use the viewer agent to request credentials from the host.</p>
            )}
            <button
              onClick={() => setCredentialModal({ open: false, deviceId: null, deviceName: '' })}
              className="mt-5 w-full text-sm text-zinc-500 hover:text-zinc-700 border border-zinc-200 rounded py-2 transition-colors"
            >
              Close
            </button>
          </div>
        </div>
      )}

      {/* Notes Modal */}
      {selectedDevice && (
        <NotesModal
          deviceId={selectedDevice.device_id}
          deviceName={selectedDevice.device_name}
          open={notesModalOpen}
          onClose={handleNotesClose}
        />
      )}

      {/* Screenshot Modal */}
      {selectedScreenshot && (
        <Dialog open={screenshotModalOpen} onOpenChange={handleScreenshotModalClose}>
          <DialogContent className="max-w-5xl">
            <div className="relative">
              <img
                src={selectedScreenshot.image}
                alt={`${selectedScreenshot.deviceName} screenshot`}
                className="w-full h-auto"
              />
            </div>
          </DialogContent>
        </Dialog>
      )}

      {/* Camera Image Modal */}
      {selectedCameraImage && (
        <Dialog open={cameraModalOpen} onOpenChange={handleCameraModalClose}>
          <DialogContent className="max-w-3xl">
            <div className="relative">
              <img
                src={selectedCameraImage.image}
                alt={`${selectedCameraImage.deviceName} camera`}
                className="w-full h-auto"
              />
            </div>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
