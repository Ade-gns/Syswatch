// Historique des alertes et compteur non lu (pastille de la barre latérale), alimentés
// par les événements du backend, qui évalue les seuils même fenêtre masquée.
import { useSyncExternalStore } from 'react';
import type { Backend } from './api';
import type { AlertEvent } from './types';

let state: { history: AlertEvent[]; unread: number } = { history: [], unread: 0 };
const listeners = new Set<() => void>();
const set = (s: typeof state) => {
  state = s;
  listeners.forEach(l => l());
};

export async function initAlerts(be: Backend) {
  set(await be.getAlerts());
  await be.onAlerts(({ events, unread }) => set({ history: [...events.slice().reverse(), ...state.history].slice(0, 200), unread }));
  await be.onAlertsRead(async () => set(await be.getAlerts()));
}

export function useAlerts() {
  return useSyncExternalStore(l => (listeners.add(l), () => listeners.delete(l)), () => state);
}
