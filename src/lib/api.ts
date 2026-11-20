// Pont avec le backend Rust. Hors de Tauri (aperçu navigateur en développement),
// une source simulée permet de comparer le rendu avec les maquettes ; elle n'est
// jamais incluse dans l'application compilée.
import { invoke, isTauri } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import type { Settings, Snapshot, SystemInfo } from './types';

export const inTauri = isTauri();

export interface Backend {
  getSystemInfo(): Promise<SystemInfo>;
  getSettings(): Promise<Settings>;
  saveSettings(s: Settings): Promise<Settings>;
  setVisible(visible: boolean): Promise<void>;
  onSnapshot(cb: (s: Snapshot) => void): Promise<() => void>;
}

const tauriBackend: Backend = {
  getSystemInfo: () => invoke('get_system_info'),
  getSettings: () => invoke('get_settings'),
  saveSettings: settings => invoke('save_settings', { settings }),
  setVisible: visible => invoke('set_visible', { visible }),
  onSnapshot: cb => listen<Snapshot>('snapshot', e => cb(e.payload)),
};

export async function backend(): Promise<Backend> {
  if (inTauri) return tauriBackend;
  if (import.meta.env.DEV) return (await import('./mock')).mockBackend;
  throw new Error('SysWatch doit être lancé dans son application.');
}
