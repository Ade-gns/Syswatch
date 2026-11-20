// État des mises à jour, partagé entre Paramètres et la barre latérale (pastille).
// Aucune requête réseau ici : `check` n'est appelé que sur clic, et la vérification au
// démarrage (si activée) est faite côté Rust, qui prévient par l'événement « update-available ».
import { useSyncExternalStore } from 'react';
import { type Backend, be, errText } from './api';
import type { UpdateInfo } from './types';

export interface UpdateState {
  info: UpdateInfo | null;
  checking: boolean;
  installing: boolean;
  /** Octets téléchargés / taille annoncée pendant l'installation. */
  progress: { done: number; total: number | null } | null;
  error: string | null;
}

let state: UpdateState = { info: null, checking: false, installing: false, progress: null, error: null };
const listeners = new Set<() => void>();
const set = (patch: Partial<UpdateState>) => {
  state = { ...state, ...patch };
  listeners.forEach(l => l());
};

export function initUpdates(backend: Backend) {
  backend.onUpdateAvailable(info => set({ info }));
  backend.onUpdateProgress(progress => set({ progress }));
}

export async function checkForUpdate() {
  set({ checking: true, error: null });
  try {
    set({ info: await be().checkUpdate() });
  } catch (e) {
    set({ error: errText(e) });
  } finally {
    set({ checking: false });
  }
}

/** En cas de succès l'application redémarre : on ne revient ici qu'en cas d'échec. */
export async function installUpdate() {
  set({ installing: true, error: null, progress: null });
  try {
    await be().installUpdate();
  } catch (e) {
    set({ error: errText(e), installing: false });
  }
}

export const useUpdate = () => useSyncExternalStore(l => (listeners.add(l), () => listeners.delete(l)), () => state);
