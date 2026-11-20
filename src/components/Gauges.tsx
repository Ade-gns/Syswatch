// Jauges du design : anneau, barre à repères de seuil, mini-courbe. Couleur par niveau
// (accent / warn / crit) via la classe l-*, jamais sur le texte de la valeur.
import type { ReactNode } from 'react';
import { num } from '../lib/format';
import { level, THRESHOLDS, type Level, type Thresholds } from '../lib/levels';

const clamp = (p: number) => Math.max(0, Math.min(100, Number.isFinite(p) ? p : 0));

export function Ring({ pct, size = 80, stroke = 8, th = THRESHOLDS.load, label = '', text, fs }: {
  pct: number; size?: number; stroke?: number; th?: Thresholds; label?: string; text?: ReactNode; fs?: number;
}) {
  const p = clamp(pct);
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const mid = size / 2;
  return (
    <div className={`sw-ring l-${level(p, th)}`} style={{ width: size, height: size }} role="img" aria-label={`${label} ${num(p)} pour cent`}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <circle className="rt" cx={mid} cy={mid} r={r} strokeWidth={stroke} />
        <circle className="rf" cx={mid} cy={mid} r={r} strokeWidth={stroke} strokeDasharray={c.toFixed(2)}
          strokeDashoffset={(c * (1 - p / 100)).toFixed(2)} transform={`rotate(-90 ${mid} ${mid})`} />
      </svg>
      <span className="c" style={{ fontSize: fs ?? Math.round(size / 5) }}>
        {text ?? <>{num(p)}<small>%</small></>}
      </span>
    </div>
  );
}

/** `lv` impose le niveau quand il ne suit pas la règle « plus haut = pire » (batterie). */
export function Bar({ pct, th = THRESHOLDS.load, ticks = true, h = 8, lv }: { pct: number; th?: Thresholds; ticks?: boolean; h?: number; lv?: Level }) {
  const p = clamp(pct);
  return (
    <div className={`sw-bar l-${lv ?? level(p, th)}`} style={{ height: h }} role="img" aria-label={`${num(p)} pour cent`}>
      <i style={{ width: `${p}%` }} />
      {ticks && th[0] <= 100 && <b style={{ left: `${th[0]}%` }} />}
      {ticks && th[1] <= 100 && <b style={{ left: `${th[1]}%` }} />}
    </div>
  );
}

export function Spark({ values, min, max, h = 32, w = 120 }: { values: number[]; min?: number; max?: number; h?: number; w?: number }) {
  const v = values.filter(Number.isFinite);
  if (v.length < 2) return <svg className="sw-spark" viewBox={`0 0 ${w} ${h}`} style={{ height: h }} aria-hidden="true" />;
  const mn = min ?? Math.min(...v);
  let mx = max ?? Math.max(...v);
  if (mx === mn) mx = mn + 1;
  const d = 'M' + v.map((y, i) => `${((i / (v.length - 1)) * w).toFixed(1)} ${(h - 2 - ((y - mn) / (mx - mn)) * (h - 4)).toFixed(1)}`).join('L');
  return (
    <svg className="sw-spark" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" style={{ height: h }} aria-hidden="true">
      <path className="a" d={`${d}L${w} ${h}L0 ${h}Z`} />
      <path className="l" d={d} />
    </svg>
  );
}
