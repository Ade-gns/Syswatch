// Miroir des structures Rust de syswatch-core (model.rs) et src-tauri (config.rs).

export interface TempReading { label: string; valueC: number }

export interface CpuSnapshot {
  usage: number;
  perThread: number[];
  freqMhz: number | null;
  perCoreFreqMhz: number[];
  tempC: number | null;
  tempPeakC: number | null;
  powerW: number | null;
  processes: number;
  threads: number;
  sensors: TempReading[];
}

export interface MemorySnapshot {
  total: number;
  used: number;
  available: number;
  free: number;
  cached: number;
  buffers: number;
  shared: number;
  dirty: number;
  swapTotal: number;
  swapUsed: number;
  swapCached: number;
  swapKind: 'zram' | 'partition' | 'fichier' | null;
}

export type SensorKind = 'cpu' | 'gpu' | 'ssd' | 'ram' | 'board' | 'battery' | 'wifi' | 'other';
export interface SensorReading { id: string; label: string; kind: SensorKind; valueC: number; critC: number | null }
export interface FanReading { id: string; label: string; rpm: number | null; pct: number | null }

export type GpuState = 'active' | 'sleeping' | 'unavailable';
export interface GpuSnapshot {
  id: string;
  state: GpuState;
  detail: string | null;
  usage: number | null;
  tempC: number | null;
  powerW: number | null;
  coreMhz: number | null;
  memMhz: number | null;
  vramUsed: number | null;
  vramTotal: number | null;
  fanPct: number | null;
  fanRpm: number | null;
  processes: number | null;
}

export interface GpuInfo {
  id: string;
  name: string;
  vendor: string;
  driver: string;
  integrated: boolean;
  maxCoreMhz: number | null;
  maxMemMhz: number | null;
  powerLimitW: number | null;
  powerShared: boolean;
  driverVersion: string | null;
}

export type BatteryStatus = 'charging' | 'discharging' | 'full' | 'notCharging' | 'unknown';
export interface BatterySnapshot {
  id: string;
  status: BatteryStatus;
  percent: number;
  energyNowWh: number | null;
  energyFullWh: number | null;
  energyDesignWh: number | null;
  wearPct: number | null;
  cycles: number | null;
  powerW: number | null;
  voltageV: number | null;
  timeLeftS: number | null;
  chargeLimit: number | null;
  technology: string | null;
  manufacturer: string | null;
  model: string | null;
}

export interface Snapshot {
  t: number;
  uptimeS: number;
  cpu: CpuSnapshot;
  memory: MemorySnapshot;
  sensors: SensorReading[];
  fans: FanReading[];
  gpus: GpuSnapshot[];
  batteries: BatterySnapshot[];
  acOnline: boolean | null;
  network: NetworkSnapshot;
  disks: DiskSnapshot[];
  fps: FpsSnapshot | null;
  selfMemBytes: number | null;
}

export type DiskKind = 'nvme' | 'ssd' | 'hdd' | 'usb';
export interface MountSnapshot { device: string; fstype: string; targets: string[]; total: number; used: number; available: number }
export interface DiskSnapshot {
  id: string;
  model: string | null;
  size: number;
  kind: DiskKind;
  removable: boolean;
  readBps: number;
  writeBps: number;
  readTotal: number;
  writeTotal: number;
  tempC: number | null;
  mounts: MountSnapshot[];
}

export type SmartStatus = 'ok' | 'warn' | 'crit';
export interface SmartAttr { id: string; name: string; value: string; threshold: string; status: SmartStatus }
export interface SmartInfo {
  available: boolean;
  detail: string | null;
  protocol: 'NVMe' | 'ATA' | null;
  health: SmartStatus | null;
  remainingPct: number | null;
  wearPct: number | null;
  powerOnHours: number | null;
  tempC: number | null;
  attributes: SmartAttr[];
  updatedS: number | null;
}

export interface FolderScan {
  disk: string;
  root: string;
  running: boolean;
  files: number;
  entries: { name: string; bytes: number }[];
  denied: number;
  finishedS: number | null;
}

export type IfaceKind = 'wifi' | 'ethernet' | 'other' | 'virtual' | 'loopback';
export interface IfaceSnapshot {
  name: string;
  kind: IfaceKind;
  up: boolean;
  rxBps: number;
  txBps: number;
  rxTotal: number;
  txTotal: number;
  mac: string | null;
  ipv4: string[];
  ipv6: string[];
  speedMbps: number | null;
}
export interface WifiInfo { iface: string; ssid: string | null; signalDbm: number | null; freqMhz: number | null; rxMbps: number | null; txMbps: number | null }
export interface NetworkSnapshot {
  rxBps: number;
  txBps: number;
  connected: boolean;
  defaultIface: string | null;
  gateway: string | null;
  dns: string[];
  pingMs: number | null;
  pingTarget: string | null;
  wifi: WifiInfo | null;
  interfaces: IfaceSnapshot[];
}

export interface ProcInfo {
  pid: number;
  ppid: number;
  name: string;
  user: string;
  cmd: string;
  threads: number;
  startS: number;
  cpu: number;
  mem: number;
  diskRead: number | null;
  diskWrite: number | null;
  netRx: number | null;
  netTx: number | null;
  app: string | null;
}
export interface AppInfo {
  id: string;
  name: string;
  pid: number;
  pids: number[];
  cpu: number;
  mem: number;
  diskRead: number;
  diskWrite: number;
  netRx: number;
  netTx: number;
}
export interface Connection {
  proto: 'TCP' | 'UDP';
  state: string;
  local: string;
  localPort: number;
  remote: string;
  remotePort: number;
  pid: number | null;
  listening: boolean;
}
export interface ProcessList { processes: ProcInfo[]; apps: AppInfo[]; connections: Connection[] }

export interface BootTimes {
  firmwareS: number | null;
  loaderS: number | null;
  kernelS: number | null;
  initrdS: number | null;
  userspaceS: number | null;
  totalS: number | null;
}
export interface AutostartEntry {
  id: string;
  name: string;
  comment: string | null;
  command: string | null;
  enabled: boolean;
  source: 'user' | 'system';
  component: boolean;
}
export interface StartupInfo {
  boot: BootTimes | null;
  bootDetail: string | null;
  slowest: { unit: string; seconds: number }[];
  autostart: AutostartEntry[];
}

export interface Feature { supported: boolean; detail: string }

export interface CpuInfo {
  model: string;
  physicalCores: number;
  logicalCpus: number;
  maxFreqMhz: number | null;
  l3CacheKb: number | null;
  governor: string | null;
  epp: string | null;
  driver: string | null;
}

export interface SystemInfo {
  osName: string;
  hostName: string | null;
  kernel: string | null;
  bootTimeS: number;
  cpu: CpuInfo;
  gpus: GpuInfo[];
  capabilities: { cpuTemp: Feature; cpuPower: Feature; cpuFreq: Feature; nvml: Feature; battery: Feature };
}

export interface Settings {
  theme: 'dark' | 'light' | 'system';
  accent: string;
  intervalMs: number;
  historyS: number;
  sidebarCollapsed: boolean;
  tempUnit: 'c' | 'f';
  fanProfile: FanProfile;
  fanCurve: [number, number][];
  alerts: AlertSettings;
  widget: WidgetSettings;
  overlay: OverlaySettings;
  closeToTray: boolean;
}

export type Corner = 'hg' | 'hd' | 'bg' | 'bd';
export interface WidgetSettings { enabled: boolean; style: 'bar' | 'card' | 'pill'; corner: Corner; opacity: number; onTop: boolean }
export type OverlayItem = 'fps' | 'cpu' | 'gpu' | 'ram' | 'vram' | 'temp' | 'net' | 'battery';
export interface OverlaySettings { enabled: boolean; style: 'standard' | 'minimal' | 'detailed'; corner: Corner; items: OverlayItem[]; fpsTarget: number; autoShow: boolean }

export type AlertRuleId = 'cpuTemp' | 'gpuTemp' | 'ssdTemp' | 'ram' | 'disk';
export interface AlertRule { id: AlertRuleId; enabled: boolean; warn: number; crit: number }
export interface AlertSettings { notify: boolean; notifyWarn: boolean; rules: AlertRule[] }
export interface AlertEvent { seq: number; key: string; rule: AlertRuleId; level: 'ok' | 'warn' | 'crit'; text: string; value: number; t: number }
export interface AlertsView { history: AlertEvent[]; unread: number }
export interface FpsSnapshot { fps: number; frametimeMs: number; low1: number | null; frametimePeakMs: number | null; game: string }
export interface MangohudStatus { installed: boolean; configured: boolean; logDir: string }

export type FanProfile = 'silencieux' | 'jeu' | 'performance';
export type FanMode =
  | { mode: 'auto' }
  | { mode: 'max' }
  | { mode: 'manual'; pct: number }
  | { mode: 'curve'; curve: { points: [number, number][] } };
export interface FanChannel {
  id: string;
  chip: string;
  label: string;
  control: 'full' | 'enableOnly';
  mode: FanMode;
  rpm: number | null;
  pct: number | null;
}
export interface FanStatus {
  helper: { installed: boolean; version: string | null; detail: string | null };
  channels: FanChannel[];
  powerProfiles: { active: string; choices: string[] } | null;
}
