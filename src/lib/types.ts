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

export interface MemorySnapshot { total: number; used: number; available: number; swapTotal: number; swapUsed: number }

export interface Snapshot {
  t: number;
  uptimeS: number;
  cpu: CpuSnapshot;
  memory: MemorySnapshot;
  selfMemBytes: number | null;
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
  capabilities: { cpuTemp: Feature; cpuPower: Feature; cpuFreq: Feature };
}

export interface Settings {
  theme: 'dark' | 'light' | 'system';
  accent: string;
  intervalMs: number;
  historyS: number;
  sidebarCollapsed: boolean;
  tempUnit: 'c' | 'f';
}
