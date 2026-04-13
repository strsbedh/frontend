import React, { useState, useEffect, useCallback } from 'react';
import { RefreshCw, CheckCircle, XCircle, AlertTriangle, Download, Monitor } from 'lucide-react';

// ── RequirementItem ───────────────────────────────────────────
function RequirementItem({ label, status, message }) {
  const icons = {
    checking: <RefreshCw className="w-4 h-4 text-zinc-400 animate-spin" />,
    pass:     <CheckCircle className="w-4 h-4 text-green-500" />,
    fail:     <XCircle className="w-4 h-4 text-red-500" />,
    warning:  <AlertTriangle className="w-4 h-4 text-yellow-500" />,
  };
  const colors = {
    checking: 'text-zinc-500',
    pass:     'text-green-700',
    fail:     'text-red-700',
    warning:  'text-yellow-700',
  };

  return (
    <div className="flex items-start gap-3 py-2">
      <div className="mt-0.5 shrink-0">{icons[status] || icons.checking}</div>
      <div>
        <div className="text-sm font-medium text-zinc-800">{label}</div>
        {message && (
          <div className={`text-xs mt-0.5 ${colors[status] || colors.checking}`}>{message}</div>
        )}
      </div>
    </div>
  );
}

// ── DriverOption ──────────────────────────────────────────────
function DriverOption({ name, description, difficulty, selected, onSelect, downloadUrl, instructions }) {
  const difficultyColor = difficulty === 'Easy' ? 'bg-green-100 text-green-700' : 'bg-yellow-100 text-yellow-700';

  return (
    <div
      onClick={onSelect}
      className={`border rounded-lg p-4 cursor-pointer transition-colors ${
        selected ? 'border-blue-500 bg-blue-50' : 'border-zinc-200 hover:border-zinc-300'
      }`}
    >
      <div className="flex items-center justify-between mb-1">
        <span className="font-medium text-zinc-900">{name}</span>
        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${difficultyColor}`}>
          {difficulty}
        </span>
      </div>
      <p className="text-sm text-zinc-500 mb-2">{description}</p>

      {selected && (
        <div className="mt-3 space-y-2">
          <ol className="text-xs text-zinc-600 space-y-1 list-decimal list-inside">
            {instructions.map((step, i) => (
              <li key={i}>{step}</li>
            ))}
          </ol>
          {downloadUrl && (
            <a
              href={downloadUrl}
              target="_blank"
              rel="noopener noreferrer"
              onClick={e => e.stopPropagation()}
              className="inline-flex items-center gap-1.5 text-xs text-blue-600 hover:text-blue-800 mt-2"
            >
              <Download className="w-3.5 h-3.5" />
              Download {name}
            </a>
          )}
        </div>
      )}
    </div>
  );
}

// ── Main Component ────────────────────────────────────────────
/**
 * Setup wizard for virtual display stealth mode.
 * @param {{ onComplete: () => void, onCancel: () => void }} props
 */
export default function VirtualDisplaySetup({ onComplete, onCancel }) {
  // Steps: 'check' → 'install' → 'complete'
  const [step, setStep] = useState('check');
  const [selectedDriver, setSelectedDriver] = useState(null);

  const [requirements, setRequirements] = useState({
    windowsVersion: { status: 'checking', message: 'Checking...' },
    adminPrivileges: { status: 'checking', message: 'Checking...' },
    virtualDisplay:  { status: 'checking', message: 'Checking...' },
  });

  const [detectedDisplay, setDetectedDisplay] = useState(null);

  const checkRequirements = useCallback(async () => {
    if (!window.electronAPI) return;

    setRequirements({
      windowsVersion: { status: 'checking', message: 'Checking...' },
      adminPrivileges: { status: 'checking', message: 'Checking...' },
      virtualDisplay:  { status: 'checking', message: 'Checking...' },
    });

    // Check Windows version
    try {
      const ver = await window.electronAPI.getWindowsVersion();
      const supported = ver.platform === 'win32' && ver.build >= 18362; // 1903
      setRequirements(r => ({
        ...r,
        windowsVersion: {
          status: supported ? 'pass' : 'fail',
          message: supported
            ? `Windows build ${ver.build} ✓`
            : `Build ${ver.build} — requires 18362+ (Windows 10 1903)`,
        },
      }));
    } catch {
      setRequirements(r => ({ ...r, windowsVersion: { status: 'warning', message: 'Could not detect version' } }));
    }

    // Check admin privileges
    try {
      const { isAdmin } = await window.electronAPI.checkAdmin();
      setRequirements(r => ({
        ...r,
        adminPrivileges: {
          status: isAdmin ? 'pass' : 'warning',
          message: isAdmin ? 'Running as administrator ✓' : 'Not admin — input blocking will be unavailable',
        },
      }));
    } catch {
      setRequirements(r => ({ ...r, adminPrivileges: { status: 'warning', message: 'Could not check privileges' } }));
    }

    // Check virtual display
    try {
      const { display } = await window.electronAPI.getVirtualDisplay();
      if (display) {
        setDetectedDisplay(display);
        setRequirements(r => ({
          ...r,
          virtualDisplay: { status: 'pass', message: `Found: ${display.deviceString || display.id} ✓` },
        }));
        setStep('complete');
      } else {
        setRequirements(r => ({
          ...r,
          virtualDisplay: { status: 'fail', message: 'No virtual display detected' },
        }));
      }
    } catch {
      setRequirements(r => ({ ...r, virtualDisplay: { status: 'fail', message: 'Detection failed' } }));
    }
  }, []);

  useEffect(() => { checkRequirements(); }, [checkRequirements]);

  // ── Render steps ──────────────────────────────────────────────

  const renderCheckStep = () => (
    <div>
      <h2 className="text-lg font-semibold text-zinc-900 mb-1">System Requirements</h2>
      <p className="text-sm text-zinc-500 mb-4">Checking your system for stealth mode compatibility.</p>

      <div className="divide-y divide-zinc-100 mb-6">
        <RequirementItem label="Windows Version" {...requirements.windowsVersion} />
        <RequirementItem label="Administrator Privileges" {...requirements.adminPrivileges} />
        <RequirementItem label="Virtual Display" {...requirements.virtualDisplay} />
      </div>

      <div className="flex gap-3">
        <button
          onClick={checkRequirements}
          className="flex items-center gap-2 text-sm px-4 py-2 border border-zinc-200 rounded hover:bg-zinc-50 transition-colors"
        >
          <RefreshCw className="w-3.5 h-3.5" />
          Recheck
        </button>
        {requirements.virtualDisplay.status === 'fail' && (
          <button
            onClick={() => setStep('install')}
            className="text-sm px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 transition-colors"
          >
            Install Virtual Display Driver
          </button>
        )}
        <button onClick={onCancel} className="text-sm text-zinc-400 hover:text-zinc-600 ml-auto">
          Cancel
        </button>
      </div>
    </div>
  );

  const renderInstallStep = () => (
    <div>
      <h2 className="text-lg font-semibold text-zinc-900 mb-1">Install Virtual Display Driver</h2>
      <p className="text-sm text-zinc-500 mb-4">
        Choose a virtual display driver to install. A virtual display is required for stealth mode.
      </p>

      <div className="space-y-3 mb-6">
        <DriverOption
          name="spacedesk"
          description="Easy-to-install virtual display driver. Recommended for most users."
          difficulty="Easy"
          selected={selectedDriver === 'spacedesk'}
          onSelect={() => setSelectedDriver('spacedesk')}
          downloadUrl="https://www.spacedesk.net/"
          instructions={[
            'Download the spacedesk DRIVER software from the link below',
            'Run the installer as Administrator',
            'Restart your computer when prompted',
            'Open Device Manager and verify a new display adapter appears',
            'Click "I\'ve Installed a Driver" below',
          ]}
        />
        <DriverOption
          name="IddSampleDriver"
          description="Microsoft's Indirect Display Driver sample. More control, requires manual setup."
          difficulty="Advanced"
          selected={selectedDriver === 'IddSampleDriver'}
          onSelect={() => setSelectedDriver('IddSampleDriver')}
          downloadUrl="https://github.com/roshkins/IddSampleDriver/releases"
          instructions={[
            'Download the latest release from GitHub',
            'Extract the zip file',
            'Right-click IddSampleDriver.inf → Install',
            'Open Device Manager → Action → Add legacy hardware',
            'Follow the wizard to install the display adapter',
            'Click "I\'ve Installed a Driver" below',
          ]}
        />
      </div>

      <div className="flex gap-3">
        <button
          onClick={checkRequirements}
          className="text-sm px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 transition-colors"
        >
          I've Installed a Driver
        </button>
        <button onClick={() => setStep('check')} className="text-sm text-zinc-400 hover:text-zinc-600">
          Back
        </button>
        <button onClick={onCancel} className="text-sm text-zinc-400 hover:text-zinc-600 ml-auto">
          Cancel
        </button>
      </div>
    </div>
  );

  const renderCompleteStep = () => (
    <div>
      <div className="flex items-center gap-3 mb-4">
        <CheckCircle className="w-8 h-8 text-green-500 shrink-0" />
        <div>
          <h2 className="text-lg font-semibold text-zinc-900">Ready for Stealth Mode</h2>
          {detectedDisplay && (
            <p className="text-sm text-zinc-500">{detectedDisplay.deviceString || detectedDisplay.id}</p>
          )}
        </div>
      </div>

      <div className="bg-zinc-50 rounded-lg p-4 mb-4 text-sm text-zinc-600 space-y-1">
        <p className="font-medium text-zinc-800 mb-2">How stealth mode works:</p>
        <ul className="space-y-1 list-disc list-inside">
          <li>Your windows move to the virtual display</li>
          <li>Screen capture switches to the virtual display</li>
          <li>A fake Windows Update screen covers your primary display</li>
          <li>The viewer sees and controls your real desktop</li>
          <li>Your keyboard input is blocked (requires admin)</li>
        </ul>
      </div>

      {requirements.adminPrivileges.status === 'warning' && (
        <div className="flex items-start gap-2 bg-yellow-50 border border-yellow-200 rounded p-3 mb-4 text-sm">
          <AlertTriangle className="w-4 h-4 text-yellow-500 shrink-0 mt-0.5" />
          <div>
            <span className="font-medium text-yellow-800">Not running as administrator.</span>
            <span className="text-yellow-700"> Input blocking will be unavailable.</span>
            <button
              onClick={() => window.electronAPI?.restartAsAdmin()}
              className="block mt-1 text-xs text-yellow-700 underline hover:text-yellow-900"
            >
              Restart as Administrator
            </button>
          </div>
        </div>
      )}

      <div className="flex gap-3">
        <button
          onClick={onComplete}
          className="flex items-center gap-2 text-sm px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 transition-colors"
        >
          <Monitor className="w-4 h-4" />
          Enable Stealth Mode
        </button>
        <button onClick={onCancel} className="text-sm text-zinc-400 hover:text-zinc-600 ml-auto">
          Cancel
        </button>
      </div>
    </div>
  );

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg p-6">
        {step === 'check'    && renderCheckStep()}
        {step === 'install'  && renderInstallStep()}
        {step === 'complete' && renderCompleteStep()}
      </div>
    </div>
  );
}
