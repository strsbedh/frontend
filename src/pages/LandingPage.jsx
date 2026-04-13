import React from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowRight, Wifi, Shield, Eye } from 'lucide-react';
import { isRegistered, getDeviceName, getDeviceId } from '../utils/device';

export default function LandingPage() {
  const navigate = useNavigate();
  const registered = isRegistered();
  const name = getDeviceName();
  const id = getDeviceId();

  return (
    <div className="min-h-screen bg-zinc-50 flex items-center justify-center p-6" data-testid="landing-page">
      <div className="w-full max-w-lg">
        {/* Header */}
        <div className="mb-12 text-center">
          <div className="inline-flex items-center gap-2 mb-6 px-3 py-1.5 bg-white border border-zinc-200 text-xs font-mono font-bold uppercase tracking-[0.2em] text-zinc-500">
            <Wifi className="w-3.5 h-3.5" strokeWidth={1.5} />
            Device-Based Access
          </div>
          <h1 className="font-heading text-4xl sm:text-5xl font-black tracking-tighter leading-none text-zinc-950 mb-4">
            Remote Desktop
          </h1>
          <p className="text-base text-zinc-500 font-body max-w-sm mx-auto">
            Persistent device-based remote access. Host is always online while active.
          </p>
        </div>

        {/* Action Buttons */}
        <div className="grid grid-cols-1 gap-4">
          <button
            onClick={() => navigate('/host')}
            className="bg-[#002FA7] hover:bg-[#001D66] text-white border border-transparent px-6 py-5 transition-colors font-medium flex items-center justify-between group"
            data-testid="start-host-btn"
          >
            <div className="flex items-center gap-3">
              <Shield className="w-5 h-5" strokeWidth={1.5} />
              <div className="text-left">
                <span className="block">{registered ? 'Open Host Agent' : 'Register as Host'}</span>
                {registered && (
                  <span className="block text-xs text-white/60 font-mono mt-0.5">
                    {name} ({id})
                  </span>
                )}
              </div>
            </div>
            <ArrowRight className="w-4 h-4 opacity-60 group-hover:opacity-100 transition-opacity" strokeWidth={1.5} />
          </button>

          <button
            onClick={() => navigate('/dashboard')}
            className="bg-white hover:bg-zinc-50 text-zinc-900 border border-zinc-200 px-6 py-5 transition-colors font-medium flex items-center justify-between group"
            data-testid="view-devices-btn"
          >
            <div className="flex items-center gap-3">
              <Eye className="w-5 h-5" strokeWidth={1.5} />
              <span>View Devices</span>
            </div>
            <ArrowRight className="w-4 h-4 opacity-0 group-hover:opacity-100 transition-opacity" strokeWidth={1.5} />
          </button>
        </div>

        {/* Footer hint */}
        <p className="text-center text-xs text-zinc-400 mt-8 font-body">
          Host shares screen automatically when viewer connects. No approval needed.
        </p>
      </div>
    </div>
  );
}
