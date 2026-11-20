// Source simulée, UNIQUEMENT pour l'aperçu navigateur en développement (npm run dev hors Tauri).
// Reprend les valeurs des maquettes pour comparer le rendu. Jamais chargée dans l'application.
import type { Backend } from './api';
import type { AutostartEntry, FanMode, FanStatus, FolderScan, ProcessList, Settings, Snapshot, StartupInfo, SystemInfo } from './types';

const MB = 1024 * 1024;
let settings: Settings = { theme: 'dark', accent: 'cyan', intervalMs: 1000, historyS: 60, sidebarCollapsed: false, tempUnit: 'c', fanProfile: 'jeu', fanCurve: [[30, 20], [45, 28], [60, 45], [75, 75], [88, 100]],
  alerts: { notify: true, notifyWarn: false, rules: [
    { id: 'cpuTemp', enabled: true, warn: 80, crit: 90 }, { id: 'gpuTemp', enabled: true, warn: 80, crit: 90 }, { id: 'ssdTemp', enabled: true, warn: 65, crit: 75 },
    { id: 'ram', enabled: true, warn: 75, crit: 90 }, { id: 'disk', enabled: true, warn: 80, crit: 90 },
  ] },
  widget: { enabled: false, style: 'bar', corner: 'hd', opacity: 85, onTop: true },
  overlay: { enabled: true, style: 'standard', corner: 'hg', items: ['fps', 'cpu', 'gpu', 'ram', 'vram', 'temp'], fpsTarget: 60, autoShow: true },
  closeToTray: true,
  checkUpdates: false,
};
const params = new URLSearchParams(location.search);
if (params.get('theme') === 'light') settings.theme = 'light';
if (params.get('ostyle')) settings.overlay.style = params.get('ostyle') as never;
if (params.get('wstyle')) settings.widget.style = params.get('wstyle') as never;

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
const rd = walk(30, 25), wr = walk(15, 12);
const cpu = walk(34, 12), ram = walk(82, 1), gpu = walk(12, 8), bat = walk(64, 0.2), dl = walk(40, 14);

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
    fans: [{ id: 'nct6775/fan1', label: 'Ventilateur CPU', rpm: 2840, pct: 52 }, { id: 'nct6775/fan2', label: 'Ventilateur GPU', rpm: 2610, pct: 48 }],
    gpus: [
      { id: '0000:01:00.0', state: 'active', detail: null, usage: gpu(), tempC: 48, powerW: 21.4, coreMhz: 1485, memMhz: 8001, vramUsed: 1.2 * 1024 ** 3, vramTotal: 8 * 1024 ** 3, fanPct: null, fanRpm: null, processes: 3 },
      { id: '0000:65:00.0', state: 'active', detail: null, usage: 4, tempC: 46, powerW: 11, coreMhz: 800, memMhz: 2800, vramUsed: 380 * 1024 ** 2, vramTotal: 512 * 1024 ** 2, fanPct: null, fanRpm: null, processes: null },
    ],
    batteries: [{
      id: 'BAT0', status: 'discharging', percent: bat(), energyNowWh: 46.2, energyFullWh: 72.1, energyDesignWh: 80, wearPct: 9.9, cycles: 243,
      powerW: 14.2 + Math.random(), voltageV: 15.4, timeLeftS: 11700, chargeLimit: 80, technology: 'Li-ion', manufacturer: 'HP', model: 'Primary',
    }],
    acOnline: false,
    fps: params.get('fps') === 'low' ? { fps: 44 + Math.random() * 6, frametimeMs: 21.3, low1: 38, frametimePeakMs: 34, game: 'Cyberpunk2077' }
      : { fps: 140 + Math.random() * 8, frametimeMs: 6.9, low1: 98, frametimePeakMs: 9.4, game: 'Cyberpunk2077' },
    disks: [
      {
        id: 'nvme0n1', model: 'Samsung SSD 980 PRO 2TB', size: 2e12, kind: 'nvme', removable: false, readBps: rd() * 14 * MB, writeBps: wr() * 9 * MB,
        readTotal: 0, writeTotal: 0, tempC: 44, mounts: [{ device: 'nvme0n1p2', fstype: 'btrfs', targets: ['/', '/home'], total: 2e12, used: 1.82e12, available: 0.18e12 }],
      },
      { id: 'sda', model: 'WDC WD20EZRZ', size: 2000398934016, kind: 'hdd', removable: false, readBps: 0, writeBps: 0, readTotal: 0, writeTotal: 0, tempC: 36, mounts: [{ device: 'sda1', fstype: 'ext4', targets: ['/mnt/donnees'], total: 1800 * 1024 ** 3, used: 900 * 1024 ** 3, available: 900 * 1024 ** 3 }] },
    ],
    network: {
      rxBps: Math.max(0, dl()) * 1024 * 1024, txBps: (3 + Math.random()) * 1024 * 1024, connected: true, defaultIface: 'wlan0', gateway: '192.168.1.1',
      dns: ['192.168.1.1'], pingMs: 14 + Math.random() * 3, pingTarget: '192.168.1.1',
      wifi: { iface: 'wlan0', ssid: 'Maison', signalDbm: -52, freqMhz: 5180, rxMbps: 866.7, txMbps: 780 },
      interfaces: [
        { name: 'wlan0', kind: 'wifi', up: true, rxBps: 42.8 * 1024 ** 2, txBps: 3.1 * 1024 ** 2, rxTotal: 18.2 * 1024 ** 3, txTotal: 1.4 * 1024 ** 3, mac: 'b4:8c:9d:00:00:01', ipv4: ['192.168.1.20/24'], ipv6: [], speedMbps: null },
        { name: 'eno1', kind: 'ethernet', up: false, rxBps: 0, txBps: 0, rxTotal: 0, txTotal: 0, mac: 'b4:8c:9d:00:00:02', ipv4: [], ipv6: [], speedMbps: null },
        { name: 'docker0', kind: 'virtual', up: true, rxBps: 0, txBps: 0, rxTotal: 0, txTotal: 0, mac: null, ipv4: ['172.17.0.1/16'], ipv6: [], speedMbps: null },
      ],
    },
    selfMemBytes: 47 * 1024 ** 2,
  };
}

// Processus de la maquette ProcessTable (SW.PROCS), en octets et octets/s.
const PROCS: [string, number, string | null, number, number, number, number][] = [
  ['firefox', 4128, 'firefox', 12.4, 2310, 0.3, 4.2], ['steam', 3011, 'steam', 6.1, 612, 1.2, 18.4], ['code', 5530, 'code', 4.8, 940, 0.1, 0],
  ['kwin_wayland', 1204, null, 3.2, 310, 0, 0], ['plasmashell', 1260, null, 2.1, 420, 0, 0], ['discord', 6102, 'discord', 1.9, 530, 0, 0.2],
  ['pipewire', 982, null, 0.9, 28, 0, 0], ['spotify', 6455, 'spotify', 0.8, 380, 0, 0.4], ['Xwayland', 1301, null, 0.6, 96, 0, 0], ['baloo_file', 1822, null, 0.4, 52, 3.1, 0],
];
const NAMES: Record<string, string> = { firefox: 'Firefox', steam: 'Steam', code: 'Visual Studio Code', discord: 'Discord', spotify: 'Spotify' };
const alive = new Set(PROCS.map(p => p[1]));
function processList(withConn: boolean): ProcessList {
  const procs = PROCS.filter(p => alive.has(p[1])).map(([name, pid, app, cpu, mem, disk, net]) => ({
    pid, ppid: 1, name, user: 'adelphe', cmd: `/usr/bin/${name}`, threads: 24, startS: Math.floor(Date.now() / 1000) - 3600, cpu: cpu * (0.8 + Math.random() * 0.4),
    mem: mem * MB, diskRead: disk * MB, diskWrite: 0, netRx: net * MB, netTx: net * MB * 0.1, app,
  }));
  const apps = procs.filter(p => p.app).map(p => ({ id: p.app!, name: NAMES[p.app!], pid: p.pid, pids: [p.pid], cpu: p.cpu, mem: p.mem, diskRead: p.diskRead, diskWrite: 0, netRx: p.netRx, netTx: p.netTx }));
  const connections = withConn ? [
    { proto: 'TCP' as const, state: 'Établie', local: '192.168.1.20', localPort: 50112, remote: '151.101.1.140', remotePort: 443, pid: 4128, listening: false },
    { proto: 'TCP' as const, state: 'Établie', local: '192.168.1.20', localPort: 50113, remote: '34.107.221.82', remotePort: 443, pid: 4128, listening: false },
    { proto: 'TCP' as const, state: 'Établie', local: '192.168.1.20', localPort: 41022, remote: '162.254.193.6', remotePort: 27017, pid: 3011, listening: false },
    { proto: 'TCP' as const, state: 'Écoute', local: '0.0.0.0', localPort: 1716, remote: '0.0.0.0', remotePort: 0, pid: null, listening: true },
  ] : [];
  return { processes: procs, apps, connections };
}
let autostart: AutostartEntry[] = [
  { id: 'discord.desktop', name: 'Discord', comment: 'Messagerie', command: 'discord --start-minimized', enabled: true, source: 'user', component: false },
  { id: 'steam.desktop', name: 'Steam', comment: 'Plateforme de jeux', command: 'steam -silent', enabled: false, source: 'user', component: false },
  { id: 'org.kde.kdeconnect.daemon.desktop', name: 'KDE Connect', comment: null, command: 'kdeconnectd', enabled: true, source: 'system', component: false },
  { id: 'org.kde.plasmashell.desktop', name: 'Plasma', comment: 'Bureau', command: null, enabled: true, source: 'system', component: true },
];
const startup = (): StartupInfo => ({
  boot: { firmwareS: 4.87, loaderS: 5.28, kernelS: 0.91, initrdS: 5.76, userspaceS: 9.88, totalS: 26.7 },
  bootDetail: null,
  slowest: [['NetworkManager-wait-online', 6.2], ['ldconfig', 2.4], ['NetworkManager', 1.6], ['docker', 1.1], ['upower', 0.4]].map(([unit, seconds]) => ({ unit: unit as string, seconds: seconds as number })),
  autostart,
});

// Machine de bureau fictive avec deux canaux pwm (nct6775) : tout est pilotable.
// « ?fans=hp » simule un portable hp-wmi (Auto / pleine vitesse), « ?fans=none » sans service.
const fansKind = params.get('fans');
let fanMode: FanMode = { mode: 'curve', curve: { points: settings.fanCurve } };
function fanStatus(): FanStatus {
  if (fansKind === 'hp') {
    return {
      helper: { installed: true, version: '0.1.0', detail: null }, powerProfiles: { active: 'balanced', choices: ['power-saver', 'balanced', 'performance'] },
      channels: [{ id: 'hp/pwm1', chip: 'hp', label: 'Ventilateurs', control: 'enableOnly', mode: fanMode.mode === 'max' ? fanMode : { mode: 'auto' }, rpm: 2840, pct: null }],
    };
  }
  return {
    helper: fansKind === 'none' ? { installed: false, version: null, detail: 'Service SysWatch non installé : lancez « cargo build --release -p syswatch-helper » puis « sudo ./scripts/install-helper.sh »' } : { installed: true, version: '0.1.0', detail: null },
    powerProfiles: null,
    channels: [
      { id: 'nct6775/pwm1', chip: 'nct6775', label: 'Ventilateur CPU', control: 'full', mode: fanMode, rpm: 2840, pct: 52 },
      { id: 'nct6775/pwm2', chip: 'nct6775', label: 'Ventilateur boîtier', control: 'full', mode: fanMode, rpm: 1210, pct: 48 },
    ],
  };
}

let savedLayout: unknown = null;
let launchAtLogin = true;

// Alertes de la maquette HomeScreen.
const now = Math.floor(Date.now() / 1000);
const at = (h: number, m: number) => { const d = new Date(); d.setHours(h, m, 0, 0); return Math.min(now, Math.floor(d.getTime() / 1000)); };
const ALERTS = [
  { seq: 2, key: 'disk:/home', rule: 'disk' as const, level: 'crit' as const, text: 'Disque /home à 91 %', value: 91, t: at(10, 2) },
  { seq: 1, key: 'ssdTemp', rule: 'ssdTemp' as const, level: 'warn' as const, text: 'SSD NVMe à 69 °C', value: 69, t: at(9, 47) },
];

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
  listProcesses: async c => processList(c),
  terminate: async pids => {
    if (pids.includes(1204)) throw new Error('Processus 1204 non fermé : appartient à un autre utilisateur');
    pids.forEach(p => alive.delete(p));
  },
  getStartup: async () => startup(),
  fanStatus: async () => fanStatus(),
  getAlerts: async () => ({ history: ALERTS, unread: 2 }),
  markAlertsRead: async () => {},
  clearAlerts: async () => {},
  onAlerts: async () => () => {},
  onAlertsRead: async () => () => {},
  setOverlayShown: async () => {},
  getOverlayShown: async () => false,
  onOverlayShown: async () => () => {},
  onSettingsChanged: async () => () => {},
  reposition: async () => {},
  mangohudStatus: async () => ({ installed: true, configured: false, logDir: '~/.local/state/syswatch/mangohud' }),
  setupMangohud: async () => '~/.config/MangoHud/MangoHud.conf',
  getLayout: async () => savedLayout,
  getLaunchAtLogin: async () => launchAtLogin,
  setLaunchAtLogin: async v => { launchAtLogin = v; },
  checkUpdate: async () => ({ current: '0.1.0', version: '0.2.0', notes: 'Aperçu : version simulée.', date: null, canInstall: true }),
  installUpdate: async () => { throw new Error('Aperçu navigateur : installation simulée.'); },
  onUpdateAvailable: async () => () => {},
  onUpdateProgress: async () => () => {},
  saveLayout: async l => { savedLayout = l; },
  setFanMode: async (_id, mode) => { fanMode = mode; },
  setPowerProfile: async () => {},
  diskSmart: async id => ({
    available: true, detail: 'udisks2', protocol: id.startsWith('nvme') ? 'NVMe' : 'ATA', health: 'ok', remainingPct: 98, wearPct: 2, powerOnHours: 4212, tempC: 44, updatedS: Math.floor(Date.now() / 1000) - 12,
    attributes: [
      ['00', 'Avertissement critique', '0', '—', 'ok'], ['03', 'Réserve disponible', '100 %', '10 %', 'ok'], ['05', 'Usure (utilisé)', '2 %', '100 %', 'ok'],
      ['80', 'Heures sous tension', '4 212 h', '—', 'ok'], ['90', 'Arrêts non sécurisés', '11', '—', 'warn'], ['A0', 'Erreurs média', '0', '—', 'ok'],
    ].map(([i, name, value, threshold, status]) => ({ id: i, name, value, threshold, status: status as 'ok' | 'warn' })),
  }),
  scanFolders: async (disk): Promise<FolderScan> => ({
    disk, root: '~', running: false, files: 412_000, denied: 0, finishedS: Math.floor(Date.now() / 1000),
    entries: [['~/Jeux/Steam', 1100], ['~/Vidéos', 380], ['~/.cache', 96], ['~/Documents', 64], ['~/Projets', 41], ['~/Images', 12]].map(([name, g]) => ({ name: name as string, bytes: (g as number) * 1e9 })),
  }),
  setAutostart: async (id, enabled) => {
    autostart = autostart.map(a => (a.id === id ? { ...a, enabled } : a));
  },
};
