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
} as const satisfies Record<string, Thresholds>;

/** Pas de seuil : la jauge reste en accent (fréquence, puissance, débit). */
export const NO_THRESHOLD: Thresholds = [101, 101];

export const level = (v: number, [warn, crit]: Thresholds = THRESHOLDS.load): Level =>
  v >= crit ? 'crit' : v >= warn ? 'warn' : 'ok';

/** Le mot qui accompagne toujours la couleur. */
export const LEVEL_WORD: Record<Level, string> = { ok: 'Normal', warn: 'Attention', crit: 'Critique' };

export const worst = (levels: Level[]): Level =>
  levels.includes('crit') ? 'crit' : levels.includes('warn') ? 'warn' : 'ok';
