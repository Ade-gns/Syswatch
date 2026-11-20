// Dernière mesure + historique glissant des séries tracées. Pas de bibliothèque d'état :
// un petit store externe lu par useSyncExternalStore.
import { useSyncExternalStore } from 'react';
import type { Snapshot, SystemInfo } from './types';

export type SeriesKey = 'cpu' | 'cpuMaxThread' | 'ram' | 'cpuTemp' | 'cpuFreqPct' | 'cpuPower';

interface State {
  latest: Snapshot | null;
  info: SystemInfo | null;
  /** Horodatages (ms) alignés sur chaque série. */
  times: number[];
  series: Record<SeriesKey, number[]>;
  version: number;
}

const KEYS: SeriesKey[] = ['cpu', 'cpuMaxThread', 'ram', 'cpuTemp', 'cpuFreqPct', 'cpuPower'];
const state: State = {
  latest: null,
  info: null,
  times: [],
  series: Object.fromEntries(KEYS.map(k => [k, []])) as unknown as Record<SeriesKey, number[]>,
  version: 0,
};
let historyMs = 60_000;
const listeners = new Set<() => void>();
const emit = () => {
  state.version++;
  listeners.forEach(l => l());
};

export function setSystemInfo(info: SystemInfo) {
  state.info = info;
  emit();
}

export function setHistorySeconds(s: number) {
  historyMs = s * 1000;
  trim();
  emit();
}

function trim() {
  const now = state.times[state.times.length - 1] ?? 0;
  // On garde un point au-delà de la fenêtre pour que la courbe touche le bord gauche.
  let drop = 0;
  while (drop < state.times.length - 1 && now - state.times[drop + 1] >= historyMs) drop++;
  if (drop > 0) {
    state.times.splice(0, drop);
    KEYS.forEach(k => state.series[k].splice(0, drop));
  }
}

export function pushSnapshot(s: Snapshot) {
  const maxFreq = state.info?.cpu.maxFreqMhz ?? null;
  const values: Record<SeriesKey, number> = {
    cpu: s.cpu.usage,
    cpuMaxThread: s.cpu.perThread.length ? Math.max(...s.cpu.perThread) : 0,
    ram: s.memory.total ? (s.memory.used / s.memory.total) * 100 : 0,
    cpuTemp: s.cpu.tempC ?? NaN,
    cpuFreqPct: s.cpu.freqMhz != null && maxFreq ? (s.cpu.freqMhz / maxFreq) * 100 : NaN,
    cpuPower: s.cpu.powerW ?? NaN,
  };
  state.latest = s;
  state.times.push(s.t);
  KEYS.forEach(k => state.series[k].push(values[k]));
  trim();
  emit();
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};
const getVersion = () => state.version;

/** Abonne le composant à chaque nouvelle mesure et renvoie l'état courant. */
export function useLive() {
  useSyncExternalStore(subscribe, getVersion);
  return { snap: state.latest, info: state.info, times: state.times, series: state.series, historyMs };
}

/** Les N dernières valeurs d'une série (mini-courbes des cartes de métrique). */
export const tail = (v: number[], n: number) => v.slice(Math.max(0, v.length - n));
