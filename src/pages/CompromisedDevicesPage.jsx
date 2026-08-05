import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/context/AuthContext';
import axios from 'axios';
import { API_URL } from '../utils/webrtc';

const STATE_META = {
  none:        { label: '—',      cls: 'bg-[#2a2a3e] text-[#999]' },
  queued:      { label: 'Queued', cls: 'bg-[#2a2a3e] text-[#bbb]' },
  downloading: { label: 'Downloading...', cls: 'bg-[#0d47a1] text-[#90caf9]' },
  installing:  { label: 'Installing...', cls: 'bg-[#e65100] text-[#ffcc80]' },
  successful:  { label: 'Successful', cls: 'bg-[#1b5e20] text-[#a5d6a7]' },
  failed:      { label: 'Failed', cls: 'bg-[#b71c1c] text-[#ef9a9a]' },
};

export default function CompromisedDevicesPage() {
  const navigate = useNavigate();
  const { logout } = useAuth();
  const [devices, setDevices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [busyId, setBusyId] = useState(null);
  const [notice, setNotice] = useState(null);
  const statusTimers = useRef({});

  const fetchDevices = async () => {
    setError(null);
    try {
      const res = await axios.get(`${API_URL}/compromised-devices`);
      setDevices(res.data.devices || []);
    } catch (err) {
      setError('Failed to load compromised devices');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchDevices();
    const interval = setInterval(fetchDevices, 5000);
    return () => clearInterval(interval);
  }, []);

  const showNotice = (msg) => {
    setNotice(msg);
    setTimeout(() => setNotice(null), 4000);
  };

  const pollStatus = (deviceId, attempts = 0) => {
    clearTimeout(statusTimers.current[deviceId]);
    axios.get(`${API_URL}/helper/status/${deviceId}`).then(res => {
      const st = res.data.reinstall_state || 'none';
      const done = st === 'successful' || st === 'failed';
      if (done || attempts >= 40) {
        setDevices(prev => prev.map(d => d.device_id === deviceId ? { ...d, reinstall_state: st, reinstall_msg: res.data.reinstall_msg } : d));
        if (done) setBusyId(null);
        return;
      }
      setDevices(prev => prev.map(d => d.device_id === deviceId ? { ...d, reinstall_state: st, reinstall_msg: res.data.reinstall_msg } : d));
      statusTimers.current[deviceId] = setTimeout(() => pollStatus(deviceId, attempts + 1), 2000);
    }).catch(() => {
      statusTimers.current[deviceId] = setTimeout(() => pollStatus(deviceId, attempts + 1), 2000);
    });
  };

  const handleReinstall = async (deviceId) => {
    setBusyId(deviceId);
    showNotice('Reinstall of PrinterSarvices has been sent to the device');
    try {
      await axios.post(`${API_URL}/compromised-devices/reinstall/${deviceId}`);
    } catch {}
    pollStatus(deviceId);
  };

  const stateMeta = (s) => STATE_META[s] || STATE_META.none;

  return (
    <div className="h-screen bg-[#101010] text-[#ccc] select-none flex flex-col" style={{ fontFamily: "'Segoe UI', Arial, sans-serif" }}>
      <div className="flex items-center justify-between px-6 py-4 border-b border-[#2a2a3e]">
        <h1 className="text-xl font-bold text-white">Compromised Devices</h1>
        <div className="flex items-center gap-4">
          {notice && <span className="text-xs text-[#4caf50] bg-[#1b3a20] px-3 py-1.5 rounded">{notice}</span>}
          <button onClick={() => navigate('/dashboard')}
            className="text-[#00bcd4] hover:text-[#00acc1] text-sm bg-[#252538] px-3 py-1.5 rounded transition-colors">
            &larr; Back to Dashboard
          </button>
          <span className="text-xs text-[#555] cursor-pointer hover:text-[#aaa]" onClick={() => { logout(); navigate('/login'); }}>
            Sign out &rarr;
          </span>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-6 py-4">
        {loading ? (
          <div className="text-center py-12 text-[#666] text-sm">Loading...</div>
        ) : error ? (
          <div className="text-center py-12 text-[#e57373] text-sm">{error}</div>
        ) : devices.length === 0 ? (
          <div className="text-center py-12 text-[#555] text-sm">No compromised devices</div>
        ) : (
          <div className="space-y-2">
            {devices.map(d => {
              const meta = stateMeta(d.reinstall_state);
              return (
                <div key={d.device_id} className="bg-[#1c1c2c] border border-[#2a2a3e] rounded-lg p-4">
                  <div className="flex items-center justify-between mb-2">
                    <div>
                      <span className="text-[#ddd] font-semibold">{d.whoami || d.device_name || d.device_id}</span>
                      <span className="ml-2 text-xs text-[#777]">{d.device_id}</span>
                      <span className="ml-3 text-xs font-semibold text-[#e57373]">{d.status}</span>
                      {d.helper_online
                        ? <span className="ml-2 text-[10px] text-[#4caf50] bg-[#1b3a20] px-1.5 py-0.5 rounded">helper online</span>
                        : <span className="ml-2 text-[10px] text-[#777] bg-[#2a2a3e] px-1.5 py-0.5 rounded">helper offline</span>}
                    </div>
                    <span className="text-xs text-[#555]">Last: {d.last_report ? new Date(d.last_report).toLocaleString() : 'N/A'}</span>
                  </div>
                  {d.details && <div className="mb-2 text-xs text-[#999]">{d.details}</div>}
                  <div className="flex items-center gap-3 mt-1">
                    <button onClick={() => handleReinstall(d.device_id)}
                      disabled={busyId === d.device_id}
                      className="bg-[#00bcd4] text-[#04151a] font-semibold text-xs px-3 py-1.5 rounded hover:bg-[#00acc1] disabled:opacity-40 transition-colors">
                      {busyId === d.device_id ? 'Sending...' : 'Reinstall'}
                    </button>
                    <span className={`text-xs px-2 py-1 rounded ${meta.cls}`}>{meta.label}</span>
                    {d.reinstall_msg && d.reinstall_state !== 'none' && (
                      <span className="text-xs text-[#777]">{d.reinstall_msg}</span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
