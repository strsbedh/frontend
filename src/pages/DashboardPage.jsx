import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { MonitorSmartphone, Wifi, WifiOff, ArrowLeft, RefreshCw, PlugZap, Monitor } from 'lucide-react';
import axios from 'axios';
import { API_URL } from '../utils/webrtc';
import NotesModal from '../components/NotesModal';
import { Dialog, DialogContent } from '../components/ui/dialog';

function DeviceCard({ device, onConnect, screenshot, onNotesClick, onScreenshotClick, onRefreshScreenshot }) {
  const isOnline = device.status === 'online';

  return (
    <div
      className={`bg-white border ${isOnline ? 'border-zinc-200 hover:border-zinc-300' : 'border-zinc-100 opacity-60'} overflow-hidden transition-all`}
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
      </div>

      {/* Device Info */}
      <div className="p-5">
        <div className="flex items-start justify-between mb-3">
          <div className="flex items-center gap-2">
            {isOnline ? (
              <Wifi className="w-4 h-4 text-green-500" strokeWidth={1.5} />
            ) : (
              <WifiOff className="w-4 h-4 text-zinc-300" strokeWidth={1.5} />
            )}
            <span className="font-medium text-zinc-900 text-sm">{device.device_name}</span>
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
          <button
            onClick={onConnect}
            className="w-full bg-[#002FA7] hover:bg-[#001D66] text-white text-sm font-medium px-4 py-2 transition-colors flex items-center justify-center gap-2"
            data-testid={`connect-btn-${device.device_id}`}
          >
            <PlugZap className="w-3.5 h-3.5" strokeWidth={1.5} />
            Connect
          </button>
        )}
      </div>
    </div>
  );
}

export default function DashboardPage() {
  const navigate = useNavigate();
  const [devices, setDevices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [screenshots, setScreenshots] = useState({});
  const [selectedDevice, setSelectedDevice] = useState(null);
  const [notesModalOpen, setNotesModalOpen] = useState(false);
  const [screenshotModalOpen, setScreenshotModalOpen] = useState(false);
  const [selectedScreenshot, setSelectedScreenshot] = useState(null);

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

  const fetchDevices = useCallback(async (showRefresh = false) => {
    if (showRefresh) setRefreshing(true);
    try {
      const res = await axios.get(`${API_URL}/devices`);
      const deviceList = res.data.devices || [];
      setDevices(deviceList);
      
      // Fetch screenshots for online devices
      await fetchScreenshots(deviceList);
    } catch {
      // silent
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [fetchScreenshots]);

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

  const onlineDevices = devices.filter(d => d.status === 'online');
  const offlineDevices = devices.filter(d => d.status === 'offline');

  return (
    <div className="min-h-screen bg-zinc-50" data-testid="dashboard-page">
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
          <button
            onClick={() => fetchDevices(true)}
            className="flex items-center gap-2 text-sm text-zinc-500 hover:text-zinc-700 transition-colors"
            data-testid="refresh-btn"
          >
            <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} strokeWidth={1.5} />
            Refresh
          </button>
        </div>
      </header>

      <main className="max-w-[1200px] mx-auto p-4 md:p-8">
        {loading ? (
          <div className="text-center py-16 text-zinc-400 text-sm">Loading devices...</div>
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
                      onConnect={() => navigate(`/viewer/${device.device_id}`)}
                      onNotesClick={() => handleNotesClick(device)}
                      onScreenshotClick={() => handleScreenshotClick(device)}
                      onRefreshScreenshot={() => handleRefreshScreenshot(device)}
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
                    />
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </main>

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
    </div>
  );
}
