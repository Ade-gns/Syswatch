// Thème et couleur d'accent (README du design, « Couleur d'accent personnalisable ») :
// on écrase --accent et --on-accent sur l'élément racine qui porte data-theme ;
// components.css en dérive --accent-soft et --accent-line. warn et crit ne changent jamais.
import { ACCENT_PRESETS } from './tokens.gen';
import type { Settings } from './types';

const lum = (hex: string) => {
  const h = hex.replace('#', '');
  const c = [0, 2, 4]
    .map(i => parseInt(h.substring(i, i + 2), 16) / 255)
    .map(v => (v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
};

/** Texte posé sur l'accent : noir #0a0c10 ou blanc, selon le meilleur contraste. */
export const onColor = (hex: string) => {
  const L = lum(hex);
  return (L + 0.05) / 0.05 >= 1.05 / (L + 0.05) ? '#0a0c10' : '#ffffff';
};

export const contrast = (a: string, b: string) => {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
};

export type ThemeName = 'dark' | 'light';

export function resolveTheme(t: Settings['theme']): ThemeName {
  if (t === 'system') return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
  return t;
}

/** Valeur de l'accent pour le thème actif : préréglage (colonne sombre ou claire) ou couleur libre. */
export function accentValue(accent: string, theme: ThemeName): string {
  const p = ACCENT_PRESETS.find(x => x.id === accent);
  if (p) return p[theme];
  return /^#[0-9a-f]{6}$/i.test(accent) ? accent : ACCENT_PRESETS[0][theme];
}

export function applyAppearance(s: Pick<Settings, 'theme' | 'accent'>) {
  const root = document.documentElement;
  const theme = resolveTheme(s.theme);
  const accent = accentValue(s.accent, theme);
  root.setAttribute('data-theme', theme);
  root.style.setProperty('--accent', accent);
  root.style.setProperty('--on-accent', onColor(accent));
}
