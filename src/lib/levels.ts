import type { SensorKind } from './types';

// Seuils des jauges (README du design, « Jauges et seuils »). Ils deviendront réglables
// par métrique dans la page Alertes ; ce module reste la source unique des valeurs par défaut.

export type Level = 'ok' | 'warn' | 'crit';
export type Thresholds = readonly [warn: number, crit: number];

export const THRESHOLDS = {
  load: [75, 90],
  disk: [80, 90],
  cpuTemp: [80, 90],
  gpuTemp: [80, 90],
  nvmeTemp: [65, 75],
  tempDefault: [65, 85],
  /** Usure de batterie (perte de capacité) : pas dans le design, valeurs usuelles. */
  batteryWear: [20, 40],
} as const satisfies Record<string, Thresholds>;

/** Seuils « bas » : la batterie est en attention sous 20 %, critique sous 10 %. */
export const BATTERY_LOW: Thresholds = [20, 10];
export const levelLow = (v: number, [warn, crit]: Thresholds = BATTERY_LOW): Level =>
  v <= crit ? 'crit' : v <= warn ? 'warn' : 'ok';

/** Seuils d'un capteur selon sa famille (README du design, « Jauges et seuils »). */
export function sensorThresholds(kind: SensorKind): Thresholds {
  return kind === 'cpu' ? THRESHOLDS.cpuTemp : kind === 'gpu' ? THRESHOLDS.gpuTemp : kind === 'ssd' ? THRESHOLDS.nvmeTemp : THRESHOLDS.tempDefault;
}

/** Pas de seuil : la jauge reste en accent (fréquence, puissance, débit). */
export const NO_THRESHOLD: Thresholds = [101, 101];

export const level = (v: number, [warn, crit]: Thresholds = THRESHOLDS.load): Level =>
  v >= crit ? 'crit' : v >= warn ? 'warn' : 'ok';

/** Le mot qui accompagne toujours la couleur. */
export const LEVEL_WORD: Record<Level, string> = { ok: 'Normal', warn: 'Attention', crit: 'Critique' };

export const worst = (levels: Level[]): Level =>
  levels.includes('crit') ? 'crit' : levels.includes('warn') ? 'warn' : 'ok';
