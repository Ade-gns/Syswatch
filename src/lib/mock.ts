// Source simulée, UNIQUEMENT pour l'aperçu navigateur en développement (npm run dev hors Tauri).
// Reprend les valeurs des maquettes pour comparer le rendu. Jamais chargée dans l'application.
import type { Backend } from './api';
import type { Settings, Snapshot, SystemInfo } from './types';

let settings: Settings = { theme: 'dark', accent: 'cyan', intervalMs: 1000, historyS: 60, sidebarCollapsed: false, tempUnit: 'c' };
const params = new URLSearchParams(location.search);
if (params.get('theme') === 'light') settings.theme = 'light';

const info: SystemInfo = {
  osName: 'CachyOS',
  hostName: 'apercu',
  kernel: '7.3.4',
  bootTimeS: Math.floor(Date.now() / 1000) - 13320,
  cpu: { model: 'AMD Ryzen 7 7840HS w/ Radeon 780M Graphics', physicalCores: 8, logicalCpus: 16, maxFreqMhz: 5100, l3CacheKb: 16384, governor: 'powersave', epp: 'balance_performance', driver: 'amd-pstate-epp' },
  capabilities: { cpuTemp: { supported: true, detail: 'k10temp · Tctl' }, cpuPower: { supported: true, detail: 'PPT du SoC (amdgpu)' }, cpuFreq: { supported: true, detail: 'amd-pstate-epp' } },
};

const walk = (base: number, amp: number) => {
  let v = base;
  return () => (v = Math.max(0, Math.min(100, v + (Math.random() - 0.5) * amp + (base - v) * 0.12)));
};
const cores = [34, 28, 41, 22, 78, 36, 19, 31, 45, 25, 93, 30, 27, 38, 21, 33].map(b => walk(b, 6));
const cpu = walk(34, 12), ram = walk(82, 1);

function snap(t: number): Snapshot {
  const total = 16 * 1024 ** 3;
  return {
    t,
    uptimeS: Math.floor(t / 1000) - info.bootTimeS,
    cpu: {
      usage: cpu(),
      perThread: cores.map(c => c()),
      freqMhz: 4380 + Math.round((Math.random() - 0.5) * 300),
      perCoreFreqMhz: [4380, 4120, 4510, 3840, 4960, 4200, 4050, 4300],
      tempC: 61 + Math.round(Math.random() * 2),
      tempPeakC: 92,
      powerW: 28 + Math.random() * 3,
      processes: 312,
      threads: 1765,
      sensors: [
        { label: 'Tctl (package)', valueC: 61 },
        { label: 'Tccd1 (cœurs)', valueC: 58 },
        { label: 'Cœur le plus chaud', valueC: 64 },
        { label: 'Zone ACPI', valueC: 52 },
      ],
    },
    memory: { total, used: (ram() / 100) * total, available: 0, swapTotal: 0, swapUsed: 0 },
    selfMemBytes: 47 * 1024 ** 2,
  };
}

export const mockBackend: Backend = {
  getSystemInfo: async () => info,
  getSettings: async () => settings,
  saveSettings: async s => (settings = s),
  setVisible: async () => {},
  onSnapshot: async cb => {
    const now = Date.now();
    for (let i = 59; i > 0; i--) cb(snap(now - i * 1000)); // historique initial plein
    const id = setInterval(() => cb(snap(Date.now())), settings.intervalMs);
    return () => clearInterval(id);
  },
};
