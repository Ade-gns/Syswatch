// Mode édition de l'Accueil : la fenêtre replie sa barre latérale et passe en « is-edit »
// (bordures pointillées des widgets), comme la maquette HomeEditScreen.
import { useSyncExternalStore } from 'react';

let editing = false;
const listeners = new Set<() => void>();

export function setEditing(v: boolean) {
  if (v === editing) return;
  editing = v;
  listeners.forEach(l => l());
}

export const useEditing = () => useSyncExternalStore(l => (listeners.add(l), () => listeners.delete(l)), () => editing);
