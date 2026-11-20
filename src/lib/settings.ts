// Paramètres partagés par l'interface ; chaque modification est enregistrée par le backend
// dans ~/.config/syswatch/settings.json puis appliquée (thème, accent, historique).
import { useSyncExternalStore } from 'react';
import { applyAppearance } from './accent';
import { applyThresholds } from './levels';
import type { Backend } from './api';
import { setHistorySeconds } from './store';
import type { Settings } from './types';

let current: Settings | null = null;
let be: Backend | null = null;
const listeners = new Set<() => void>();

function apply(s: Settings) {
  current = s;
  applyAppearance(s);
  applyThresholds(s.alerts.rules);
  setHistorySeconds(s.historyS);
  listeners.forEach(l => l());
}

export function initSettings(backend: Backend, s: Settings) {
  be = backend;
  apply(s);
  // Réglages changés depuis l'icône de notification (widget activé ou non).
  backend.onSettingsChanged(apply);
  // Thème « Système » : suivre les changements du bureau.
  window.matchMedia('(prefers-color-scheme: light)').addEventListener('change', () => {
    if (current?.theme === 'system') applyAppearance(current);
  });
}

export async function updateSettings(patch: Partial<Settings>) {
  if (!current || !be) return;
  const optimistic = { ...current, ...patch };
  apply(optimistic);
  try {
    apply(await be.saveSettings(optimistic));
  } catch (e) {
    console.error(e);
  }
}

export function useSettings(): Settings {
  const s = useSyncExternalStore(
    l => (listeners.add(l), () => listeners.delete(l)),
    () => current,
  );
  if (!s) throw new Error('Paramètres non chargés');
  return s;
}
