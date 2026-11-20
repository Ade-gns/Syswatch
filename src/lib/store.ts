// Dernière mesure + historique glissant des séries tracées. Pas de bibliothèque d'état :
// un petit store externe lu par useSyncExternalStore.
//
// Les séries sont indexées par clé : fixes (« cpu », « ram »…) ou par appareil
// (« gpu:0000:01:00.0:usage »). Une série qui apparaît en cours de route est complétée
// de NaN pour rester alignée sur les horodatages ; NaN = trou dans la courbe.
import { useSyncExternalStore } from 'react';
import type { Snapshot, SystemInfo } from './types';

export type Series = Record<string, number[]>;

interface State {
  latest: Snapshot | null;
  info: SystemInfo | null;
  /** Horodatages (ms) alignés sur chaque série. */
  times: number[];
  series: Series;
  /** Maximum observé depuis le lancement, par clé de série. */
  peaks: Record<string, number>;
  version: number;
}

const state: State = { latest: null, info: null, times: [], series: {}, peaks: {}, version: 0 };
let historyMs = 60_000;
const listeners = new Set<() => void>();
const emit = () => {
  state.version++;
  listeners.forEach(l => l());
};

export const gpuKey = (id: string, m: 'usage' | 'temp' | 'power' | 'vram') => `gpu:${id}:${m}`;
export const diskKey = (id: string, m: 'read' | 'write' | 'temp') => `disk:${id}:${m}`;

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
    Object.values(state.series).forEach(v => v.splice(0, drop));
  }
}

const pct = (a: number, b: number) => (b > 0 ? (a / b) * 100 : NaN);
const orNaN = (v: number | null | undefined) => v ?? NaN;

/** Valeurs tracées extraites d'une mesure. */
function extract(s: Snapshot): Record<string, number> {
  const maxFreq = state.info?.cpu.maxFreqMhz ?? null;
  const v: Record<string, number> = {
    cpu: s.cpu.usage,
    cpuMaxThread: s.cpu.perThread.length ? Math.max(...s.cpu.perThread) : 0,
    ram: pct(s.memory.used, s.memory.total),
    swap: pct(s.memory.swapUsed, s.memory.swapTotal),
    cpuTemp: orNaN(s.cpu.tempC),
    cpuFreqPct: s.cpu.freqMhz != null && maxFreq ? (s.cpu.freqMhz / maxFreq) * 100 : NaN,
    cpuPower: orNaN(s.cpu.powerW),
  };
  for (const g of s.gpus) {
    v[gpuKey(g.id, 'usage')] = orNaN(g.usage);
    v[gpuKey(g.id, 'temp')] = orNaN(g.tempC);
    v[gpuKey(g.id, 'power')] = orNaN(g.powerW);
    v[gpuKey(g.id, 'vram')] = g.vramUsed != null && g.vramTotal ? pct(g.vramUsed, g.vramTotal) : NaN;
  }
  for (const d of s.disks) {
    v[diskKey(d.id, 'read')] = d.readBps;
    v[diskKey(d.id, 'write')] = d.writeBps;
    v[diskKey(d.id, 'temp')] = orNaN(d.tempC);
  }
  for (const f of s.fans) v[`fan:${f.id}`] = orNaN(f.rpm);
  v.netRx = s.network.rxBps;
  v.netTx = s.network.txBps;
  v.ping = orNaN(s.network.pingMs);
  const b = s.batteries[0];
  if (b) {
    v.batLevel = b.percent;
    v.batPower = orNaN(b.powerW);
  }
  return v;
}

export function pushSnapshot(s: Snapshot) {
  const values = extract(s);
  const n = state.times.length;
  for (const k of Object.keys(values)) {
    if (!state.series[k]) state.series[k] = new Array(n).fill(NaN);
    const x = values[k];
    if (Number.isFinite(x) && !(x <= (state.peaks[k] ?? -Infinity))) state.peaks[k] = x;
  }
  state.latest = s;
  state.times.push(s.t);
  for (const k of Object.keys(state.series)) state.series[k].push(values[k] ?? NaN);
  trim();
  emit();
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};
const getVersion = () => state.version;

const EMPTY: number[] = [];

/** Abonne le composant à chaque nouvelle mesure et renvoie l'état courant. */
export function useLive() {
  useSyncExternalStore(subscribe, getVersion);
  const get = (k: string) => state.series[k] ?? EMPTY;
  return { snap: state.latest, info: state.info, times: state.times, series: state.series, get, peaks: state.peaks, historyMs };
}

/** Les N dernières valeurs d'une série (mini-courbes des cartes de métrique). */
export const tail = (v: number[] | undefined, n: number) => (v ?? EMPTY).slice(Math.max(0, (v ?? EMPTY).length - n));

/** Série ramenée sur 0–100 par rapport à son maximum (mini-courbes de puissance). */
export function normalized(v: number[]) {
  const m = Math.max(1, ...v.filter(Number.isFinite));
  return v.map(x => (x / m) * 100);
}
