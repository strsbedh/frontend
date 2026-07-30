import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/context/AuthContext';
import axios from 'axios';
import { API_URL } from '../utils/webrtc';

export default function CompromisedDevicesPage() {
  const navigate = useNavigate();
  const { logout } = useAuth();
  const [devices, setDevices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

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

  const statusColor = (status) => {
    switch (status) {
      case 'ok': return 'text-[#4caf50]';
      case 'compromised': return 'text-[#e57373]';
      case 'buddy_down': return 'text-[#ffa726]';
      default: return 'text-[#888]';
    }
  };

  return (
    <div className="h-screen bg-[#101010] text-[#ccc] select-none flex flex-col" style={{ fontFamily: "'Segoe UI', Arial, sans-serif" }}>
      <div className="flex items-center justify-between px-6 py-4 border-b border-[#2a2a3e]">
        <h1 className="text-xl font-bold text-white">Compromised Devices</h1>
        <div className="flex items-center gap-4">
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
          <div className="text-center py-12 text-[#555] text-sm">No compromised devices reported</div>
        ) : (
          <div className="space-y-2">
            {devices.map(d => {
              const watchdogs = d.watchdogs || {};
              const entries = Object.entries(watchdogs);
              return (
                <div key={d.device_id} className="bg-[#1c1c2c] border border-[#2a2a3e] rounded-lg p-4">
                  <div className="flex items-center justify-between mb-2">
                    <div>
                      <span className="text-[#ddd] font-semibold">{d.device_id}</span>
                      <span className={`ml-3 text-xs font-semibold ${statusColor(d.status)}`}>{d.status}</span>
                    </div>
                    <span className="text-xs text-[#555]">Last: {d.last_report ? new Date(d.last_report).toLocaleString() : 'N/A'}</span>
                  </div>
                  {entries.length > 0 && (
                    <div className="ml-2 space-y-1">
                      {entries.map(([name, info]) => (
                        <div key={name} className="text-xs text-[#777] flex items-center gap-2">
                          <span className="text-[#999]">{name}:</span>
                          <span className={statusColor(info.status || 'unknown')}>{info.status || 'unknown'}</span>
                          <span className="text-[#555]">{info.last_report ? new Date(info.last_report).toLocaleString() : ''}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
