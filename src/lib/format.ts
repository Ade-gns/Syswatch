// Formats d'affichage du design : virgule décimale, espace insécable avant l'unité,
// espace fine insécable entre les milliers (fr-FR) : « 61 °C », « 42,8 Mo/s », « 2 840 tr/min ».

export const NBSP = ' ';

const cache = new Map<number, Intl.NumberFormat>();
const nf = (d: number) => {
  let f = cache.get(d);
  if (!f) {
    f = new Intl.NumberFormat('fr-FR', { minimumFractionDigits: d, maximumFractionDigits: d });
    cache.set(d, f);
  }
  return f;
};

/** Nombre au format français. */
export const num = (v: number, d = 0) => nf(d).format(v);

/** Valeur et unité séparées par une espace insécable. */
export const withUnit = (v: string, unit: string) => `${v}${NBSP}${unit}`;

/** Valeur + unité séparées, pour les affichages où l'unité a son propre style. */
export type Parts = [value: string, unit: string];

const UNITS = ['o', 'Ko', 'Mo', 'Go', 'To'];

/** Octets en unités binaires, libellées Mo/Go/To comme dans les maquettes. */
export function bytes(b: number, opts: { trim?: boolean } = {}): Parts {
  let i = 0;
  let v = b;
  while (v >= 1024 && i < UNITS.length - 1) {
    v /= 1024;
    i++;
  }
  const u = UNITS[i];
  let d = u === 'To' ? (v < 10 ? 2 : 1) : u === 'Go' ? (v >= 100 ? 0 : 1) : 0;
  // Capacités totales : « 16 Go » plutôt que « 16,0 Go ». Jamais pour une valeur qui varie.
  if (opts.trim && Math.abs(v - Math.round(v)) < 0.05) d = 0;
  return [num(v, d), u];
}

export const bytesStr = (b: number) => withUnit(...bytes(b));

/** Durée « 3 h 42 », « 12 min », « 2 j 4 h ». */
export function duration(s: number): string {
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (d > 0) return `${d}${NBSP}j ${h}${NBSP}h`;
  if (h > 0) return `${h}${NBSP}h ${String(m).padStart(2, '0')}`;
  return `${m}${NBSP}min`;
}

/** Température dans l'unité choisie. Les seuils restent toujours évalués en °C. */
export function temp(c: number, unit: 'c' | 'f' = 'c'): Parts {
  return unit === 'f' ? [num(c * 1.8 + 32), '°F'] : [num(c), '°C'];
}
export const tempStr = (c: number, unit: 'c' | 'f' = 'c') => withUnit(...temp(c, unit));

export const ghz = (mhz: number) => num(mhz / 1000, 2);
export const mhz = (v: number) => withUnit(num(v), 'MHz');

/** Nom court de processeur : « AMD Ryzen 5 5600H with Radeon Graphics » → « Ryzen 5 5600H ». */
export function shortCpuName(model: string): string {
  return model
    .replace(/\((R|TM)\)/gi, '')
    .replace(/^(AMD|Intel)\s+/i, '')
    .replace(/\s+(with|w\/)\s+Radeon.*$/i, '')
    .replace(/\s+\d+-Core Processor$/i, '')
    .replace(/\s+CPU\s+@.*$/i, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Intervalle « 0,5 s », « 1 s », « 1 min ». */
export const seconds = (s: number) => (s >= 60 && s % 60 === 0 ? withUnit(num(s / 60), 'min') : withUnit(num(s, s % 1 ? 1 : 0), 's'));
