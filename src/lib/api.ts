// Pont avec le backend Rust. Hors de Tauri (aperçu navigateur en développement),
// une source simulée permet de comparer le rendu avec les maquettes ; elle n'est
// jamais incluse dans l'application compilée.
import { invoke, isTauri } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import type { ProcessList, Settings, Snapshot, StartupInfo, SystemInfo } from './types';

export const inTauri = isTauri();

export interface Backend {
  getSystemInfo(): Promise<SystemInfo>;
  getSettings(): Promise<Settings>;
  saveSettings(s: Settings): Promise<Settings>;
  setVisible(visible: boolean): Promise<void>;
  onSnapshot(cb: (s: Snapshot) => void): Promise<() => void>;
  /** Processus et applications ; `connections` ajoute la liste des sockets (page Réseau). */
  listProcesses(connections: boolean): Promise<ProcessList>;
  /** SIGTERM ; rejette avec un message lisible si un processus n'a pas pu être fermé. */
  terminate(pids: number[]): Promise<void>;
  getStartup(): Promise<StartupInfo>;
  setAutostart(id: string, enabled: boolean): Promise<void>;
}

const tauriBackend: Backend = {
  getSystemInfo: () => invoke('get_system_info'),
  getSettings: () => invoke('get_settings'),
  saveSettings: settings => invoke('save_settings', { settings }),
  setVisible: visible => invoke('set_visible', { visible }),
  onSnapshot: cb => listen<Snapshot>('snapshot', e => cb(e.payload)),
  listProcesses: connections => invoke('list_processes', { connections }),
  terminate: pids => invoke('terminate', { pids }),
  getStartup: () => invoke('get_startup'),
  setAutostart: (id, enabled) => invoke('set_autostart', { id, enabled }),
};

/** Message d'erreur lisible : Tauri rejette avec une chaîne, le reste avec une Error. */
export const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

let current: Backend | null = null;
/** Backend actif (défini au lancement par main.tsx). */
export const be = () => {
  if (!current) throw new Error('Backend non initialisé');
  return current;
};

export async function backend(): Promise<Backend> {
  if (inTauri) return (current = tauriBackend);
  if (import.meta.env.DEV) return (current = (await import('./mock')).mockBackend);
  throw new Error('SysWatch doit être lancé dans son application.');
}
