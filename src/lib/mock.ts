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
  gpus: [
    { id: '0000:01:00.0', name: 'GeForce RTX 4060 Laptop GPU', vendor: 'NVIDIA', driver: 'nvidia', integrated: false, maxCoreMhz: 2370, maxMemMhz: 8001, powerLimitW: 115, powerShared: false, driverVersion: '620.70.06' },
    { id: '0000:65:00.0', name: 'Radeon 780M', vendor: 'AMD', driver: 'amdgpu', integrated: true, maxCoreMhz: 2700, maxMemMhz: 2800, powerLimitW: null, powerShared: true, driverVersion: null },
  ],
  capabilities: {
    cpuTemp: { supported: true, detail: 'k10temp · Tctl' },
    cpuPower: { supported: true, detail: 'PPT du SoC (amdgpu)' },
    cpuFreq: { supported: true, detail: 'amd-pstate-epp' },
    nvml: { supported: true, detail: 'NVML' },
    battery: { supported: true, detail: 'power_supply' },
  },
};

const walk = (base: number, amp: number) => {
  let v = base;
  return () => (v = Math.max(0, Math.min(100, v + (Math.random() - 0.5) * amp + (base - v) * 0.12)));
};
const cores = [34, 28, 41, 22, 78, 36, 19, 31, 45, 25, 93, 30, 27, 38, 21, 33].map(b => walk(b, 6));
const cpu = walk(34, 12), ram = walk(82, 1), gpu = walk(12, 8), bat = walk(64, 0.2);

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
    memory: {
      total, used: (ram() / 100) * total, available: 2.9 * 1024 ** 3, free: 0.6 * 1024 ** 3, cached: 2.1 * 1024 ** 3, buffers: 0.1 * 1024 ** 3,
      shared: 0.4 * 1024 ** 3, dirty: 12 * 1024 ** 2, swapTotal: total, swapUsed: 0.3 * 1024 ** 3, swapCached: 20 * 1024 ** 2, swapKind: 'zram',
    },
    sensors: [
      { id: 'k10temp/temp1', label: 'CPU', kind: 'cpu', valueC: 61, critC: null },
      { id: 'nvidia/0000:01:00.0', label: 'GPU', kind: 'gpu', valueC: 48, critC: null },
      { id: 'nvme/temp1', label: 'SSD NVMe', kind: 'ssd', valueC: 69, critC: 84.85 },
      { id: 'acpitz/temp1', label: 'Zone ACPI', kind: 'board', valueC: 52, critC: null },
      { id: 'BAT0/temp1', label: 'Batterie', kind: 'battery', valueC: 34, critC: null },
    ],
    fans: [{ id: 'hp/fan1', label: 'Ventilateur 1', rpm: 2840, pct: null }],
    gpus: [
      { id: '0000:01:00.0', state: 'active', detail: null, usage: gpu(), tempC: 48, powerW: 21.4, coreMhz: 1485, memMhz: 8001, vramUsed: 1.2 * 1024 ** 3, vramTotal: 8 * 1024 ** 3, fanPct: null, fanRpm: null, processes: 3 },
      { id: '0000:65:00.0', state: 'active', detail: null, usage: 4, tempC: 46, powerW: 11, coreMhz: 800, memMhz: 2800, vramUsed: 380 * 1024 ** 2, vramTotal: 512 * 1024 ** 2, fanPct: null, fanRpm: null, processes: null },
    ],
    batteries: [{
      id: 'BAT0', status: 'discharging', percent: bat(), energyNowWh: 46.2, energyFullWh: 72.1, energyDesignWh: 80, wearPct: 9.9, cycles: 243,
      powerW: 14.2 + Math.random(), voltageV: 15.4, timeLeftS: 11700, chargeLimit: 80, technology: 'Li-ion', manufacturer: 'HP', model: 'Primary',
    }],
    acOnline: false,
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
