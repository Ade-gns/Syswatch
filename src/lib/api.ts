// Pont avec le backend Rust. Hors de Tauri (aperçu navigateur en développement),
// une source simulée permet de comparer le rendu avec les maquettes ; elle n'est
// jamais incluse dans l'application compilée.
import { invoke, isTauri } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import type { AlertEvent, AlertsView, FanMode, MangohudStatus, FanStatus, FolderScan, ProcessList, Settings, SmartInfo, Snapshot, StartupInfo, SystemInfo, UpdateInfo } from './types';

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
  diskSmart(id: string): Promise<SmartInfo>;
  /** Lance l'analyse d'espace par dossier si besoin ; à rappeler tant que `running`. */
  scanFolders(disk: string, force: boolean): Promise<FolderScan>;
  fanStatus(): Promise<FanStatus>;
  /** Passe par le service privilégié (polkit) ; rejette avec un message lisible. */
  setFanMode(id: string, mode: FanMode): Promise<void>;
  /** power-profiles-daemon : « power-saver », « balanced », « performance ». */
  setPowerProfile(name: string): Promise<void>;
  getAlerts(): Promise<AlertsView>;
  markAlertsRead(): Promise<void>;
  clearAlerts(): Promise<void>;
  /** Nouvelles alertes (et total non lu), et remise à zéro du compteur. */
  onAlerts(cb: (e: { events: AlertEvent[]; unread: number }) => void): Promise<() => void>;
  onAlertsRead(cb: () => void): Promise<() => void>;
  /** Overlay du mode jeu affiché (raccourci, icône ou interrupteur « Mode jeu »). */
  setOverlayShown(shown: boolean): Promise<void>;
  getOverlayShown(): Promise<boolean>;
  onOverlayShown(cb: (shown: boolean) => void): Promise<() => void>;
  /** Réglages modifiés hors de l'interface (icône de notification). */
  onSettingsChanged(cb: (s: Settings) => void): Promise<() => void>;
  /** Widget/overlay redimensionné : le replacer dans son coin. */
  reposition(label: string): Promise<void>;
  mangohudStatus(): Promise<MangohudStatus>;
  setupMangohud(): Promise<string>;
  /** Disposition de l'Accueil enregistrée (validée par l'interface), ou null. */
  getLayout(): Promise<unknown>;
  saveLayout(layout: unknown): Promise<void>;
  getLaunchAtLogin(): Promise<boolean>;
  setLaunchAtLogin(enabled: boolean): Promise<void>;
  /** Interroge les Releases GitHub (seule requête Internet de SysWatch, à la demande). */
  checkUpdate(): Promise<UpdateInfo>;
  /** Télécharge, vérifie la signature, remplace l'AppImage et redémarre. */
  installUpdate(): Promise<void>;
  /** Version trouvée par la vérification au démarrage. */
  onUpdateAvailable(cb: (u: UpdateInfo) => void): Promise<() => void>;
  onUpdateProgress(cb: (p: { done: number; total: number | null }) => void): Promise<() => void>;
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
  diskSmart: id => invoke('disk_smart', { id }),
  scanFolders: (disk, force) => invoke('scan_folders', { disk, force }),
  fanStatus: () => invoke('fan_status'),
  setFanMode: (id, mode) => invoke('set_fan_mode', { id, mode }),
  setPowerProfile: name => invoke('set_power_profile', { name }),
  getAlerts: () => invoke('get_alerts'),
  markAlertsRead: () => invoke('mark_alerts_read'),
  clearAlerts: () => invoke('clear_alerts'),
  onAlerts: cb => listen<{ events: AlertEvent[]; unread: number }>('alerts', e => cb(e.payload)),
  onAlertsRead: cb => listen('alerts-read', () => cb()),
  setOverlayShown: shown => invoke('set_overlay_shown', { shown }),
  getOverlayShown: () => invoke('get_overlay_shown'),
  onOverlayShown: cb => listen<boolean>('overlay-shown', e => cb(e.payload)),
  onSettingsChanged: cb => listen<Settings>('settings-changed', e => cb(e.payload)),
  reposition: label => invoke('reposition', { label }),
  mangohudStatus: () => invoke('mangohud_status'),
  setupMangohud: () => invoke('setup_mangohud'),
  getLayout: () => invoke('get_layout'),
  saveLayout: layout => invoke('save_layout', { layout }),
  getLaunchAtLogin: () => invoke('get_launch_at_login'),
  setLaunchAtLogin: enabled => invoke('set_launch_at_login', { enabled }),
  checkUpdate: () => invoke('check_update'),
  installUpdate: () => invoke('install_update'),
  onUpdateAvailable: cb => listen<UpdateInfo>('update-available', e => cb(e.payload)),
  onUpdateProgress: cb => listen<{ done: number; total: number | null }>('update-progress', e => cb(e.payload)),
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
