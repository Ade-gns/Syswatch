// Disposition de l'Accueil : grille de 12 colonnes (README : un widget occupe 3, 4, 5, 6,
// 7, 8 ou 12 colonnes) et de rangées de 56 px — une carte de métrique de 128 px fait
// 2 rangées (2 × 56 + gouttière de 16). Fonctions pures : collisions, déplacement avec
// refoulement vers le bas, tassement vers le haut, ajout à la première place libre.

export const COLS = 12;
export const ROW_PX = 56;
export const WIDTHS = [3, 4, 5, 6, 7, 8, 12] as const;

export interface Item {
  /** Identifiant d'instance (un même type peut figurer deux fois). */
  id: string;
  type: string;
  x: number;
  y: number;
  w: number;
  h: number;
}
export type Layout = Item[];

/** Largeur autorisée la plus proche. */
export function snapWidth(w: number) {
  return WIDTHS.reduce((best, v) => (Math.abs(v - w) < Math.abs(best - w) ? v : best), WIDTHS[0] as number);
}

export const collides = (a: Item, b: Item) =>
  a.id !== b.id && a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

const clampItem = (it: Item): Item => {
  const w = snapWidth(Math.min(COLS, Math.max(3, it.w)));
  return { ...it, w, h: Math.max(1, Math.round(it.h)), x: Math.max(0, Math.min(COLS - w, Math.round(it.x))), y: Math.max(0, Math.round(it.y)) };
};

/** Fait remonter chaque widget aussi haut que possible, dans l'ordre de lecture. */
export function compact(layout: Layout): Layout {
  const sorted = [...layout].sort((a, b) => a.y - b.y || a.x - b.x);
  const placed: Item[] = [];
  for (const it of sorted) {
    const n = { ...it };
    while (n.y > 0 && !placed.some(p => collides({ ...n, y: n.y - 1 }, p))) n.y--;
    while (placed.some(p => collides(n, p))) n.y++;
    placed.push(n);
  }
  return placed;
}

/** Place `moved` puis repousse vers le bas tout ce qu'il chevauche, en cascade. */
function settle(layout: Layout, moved: Item): Layout {
  const out = layout.map(i => (i.id === moved.id ? moved : { ...i }));
  const queue = [moved];
  while (queue.length) {
    const cur = queue.shift()!;
    for (const o of out) {
      if (o.id !== cur.id && collides(cur, o)) {
        o.y = cur.y + cur.h;
        queue.push(o);
      }
    }
  }
  return out;
}

/** Déplace (sans tasser : la place d'origine reste libre pendant le geste). */
export function move(layout: Layout, id: string, x: number, y: number): Layout {
  const it = layout.find(i => i.id === id);
  return it ? settle(layout, clampItem({ ...it, x, y })) : layout;
}

export function resize(layout: Layout, id: string, w: number, h: number, minH = 2): Layout {
  const it = layout.find(i => i.id === id);
  if (!it) return layout;
  const n = clampItem({ ...it, w, h: Math.max(minH, h) });
  return settle(layout, { ...n, x: Math.min(n.x, COLS - n.w) });
}

export function remove(layout: Layout, id: string): Layout {
  return compact(layout.filter(i => i.id !== id));
}

/** Ajoute à la première place libre (lecture de gauche à droite, de haut en bas). */
export function add(layout: Layout, type: string, w: number, h: number): Layout {
  const id = `${type}-${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`;
  const bottom = layout.reduce((m, i) => Math.max(m, i.y + i.h), 0);
  for (let y = 0; y <= bottom; y++) {
    for (let x = 0; x + w <= COLS; x++) {
      const cand = { id, type, x, y, w, h };
      if (!layout.some(i => collides(cand, i))) return [...layout, cand];
    }
  }
  return [...layout, { id, type, x: 0, y: bottom, w, h }];
}

/** Disposition chargée depuis le disque : champs vérifiés, types inconnus écartés. */
export function sanitize(raw: unknown, known: (t: string) => boolean): Layout | null {
  if (!Array.isArray(raw)) return null;
  const items = raw
    .filter((i): i is Item => !!i && typeof i === 'object' && typeof i.id === 'string' && typeof i.type === 'string' && known(i.type)
      && [i.x, i.y, i.w, i.h].every(v => Number.isFinite(v)))
    .slice(0, 40)
    .map(clampItem);
  // Chevauchements éventuels (fichier édité à la main) : résolus par refoulement.
  let out: Layout = [];
  for (const it of items) out = settle([...out, it], it);
  return out.length ? compact(out) : null;
}

export const rowsOf = (layout: Layout) => layout.reduce((m, i) => Math.max(m, i.y + i.h), 0);
