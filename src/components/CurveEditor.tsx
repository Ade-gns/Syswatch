// Éditeur de courbe température → vitesse (composant « FanControl » du design, SW.curve) :
// chaque point se glisse de 30 à 100 °C sans jamais dépasser ses voisins ; flèches au
// clavier (←/→ : 1 °C, ↑/↓ : 5 %) ; la température courante est repérée par un trait
// pointillé et sa vitesse lue dans une étiquette. `onCommit` à la fin d'un geste.
import { useEffect, useRef, useState } from 'react';

export type Points = [number, number][];

const W = 560, PL = 46, PR = 16, PT = 14, PB = 30, X0 = 30, X1 = 100;

export function curveAt(pts: Points, t: number) {
  if (t <= pts[0][0]) return pts[0][1];
  for (let i = 1; i < pts.length; i++) {
    if (t <= pts[i][0]) {
      const [a, b] = [pts[i - 1], pts[i]];
      return a[1] + ((b[1] - a[1]) * (t - a[0])) / (b[0] - a[0] || 1);
    }
  }
  return pts[pts.length - 1][1];
}

export function CurveEditor({ points, temp, h = 260, disabled = false, onCommit }: {
  points: Points;
  temp: number | null;
  h?: number;
  disabled?: boolean;
  onCommit?: (p: Points) => void;
}) {
  const [pts, setPts] = useState<Points>(points);
  const [drag, setDrag] = useState(-1);
  const svg = useRef<SVGSVGElement>(null);
  // Suivre les points reçus (profil changé ailleurs) sauf pendant un geste.
  useEffect(() => { if (drag < 0) setPts(points); }, [points]); // eslint-disable-line react-hooks/exhaustive-deps

  const H = h;
  const sx = (t: number) => PL + ((t - X0) / (X1 - X0)) * (W - PL - PR);
  const sy = (p: number) => PT + (1 - p / 100) * (H - PT - PB);

  const setPt = (i: number, t: number, p: number, base = pts) => {
    const lo = i ? base[i - 1] : [X0 - 2, 0];
    const hi = i < base.length - 1 ? base[i + 1] : [X1 + 2, 100];
    const nt = Math.max(X0, Math.round(Math.max(lo[0] + 2, Math.min(hi[0] - 2, t, X1))));
    const np = Math.round(Math.max(lo[1], Math.min(hi[1], p, 100)));
    const next = base.map((q, k) => (k === i ? [nt, np] : q)) as Points;
    setPts(next);
    return next;
  };

  const fromEvent = (e: React.PointerEvent) => {
    const r = svg.current!.getBoundingClientRect();
    const x = ((e.clientX - r.left) / r.width) * W, y = ((e.clientY - r.top) / r.height) * H;
    return [X0 + ((x - PL) / (W - PL - PR)) * (X1 - X0), 100 * (1 - (y - PT) / (H - PT - PB))];
  };

  const d = pts.map((p, i) => `${i ? 'L' : 'M'}${sx(p[0]).toFixed(1)} ${sy(p[1]).toFixed(1)}`).join('');
  const full = `M${sx(X0)} ${sy(pts[0][1])}${d.replace(/^M[^L]*/, '')}L${sx(X1)} ${sy(pts[pts.length - 1][1])}`;
  const t = temp != null ? Math.min(X1, Math.max(X0, Math.round(temp))) : null;
  const speed = t != null ? Math.round(curveAt(pts, t)) : null;
  const lx = t != null ? sx(t) : 0;
  const tx = Math.min(Math.max(lx, PL + 66), W - PR - 66);

  return (
    <div className="sw-curve" aria-disabled={disabled || undefined} style={disabled ? { opacity: 0.45 } : undefined}>
      <svg ref={svg} viewBox={`0 0 ${W} ${H}`} role="group"
        aria-label="Courbe température vers vitesse du ventilateur. Utilisez les flèches sur un point pour l’ajuster."
        onPointerMove={e => { if (drag >= 0) { const [a, b] = fromEvent(e); setPt(drag, a, b); } }}
        onPointerUp={() => { if (drag >= 0) { setDrag(-1); onCommit?.(pts); } }}
        onPointerCancel={() => setDrag(-1)}>
        {[30, 40, 50, 60, 70, 80, 90, 100].map(v => (
          <g key={`x${v}`}>
            <line className="gl" x1={sx(v)} x2={sx(v)} y1={PT} y2={H - PB} />
            <text className="ax" x={sx(v)} y={H - 10} textAnchor="middle">{v}°</text>
          </g>
        ))}
        {[0, 25, 50, 75, 100].map(v => (
          <g key={`y${v}`}>
            <line className="gl" x1={PL} x2={W - PR} y1={sy(v)} y2={sy(v)} />
            <text className="ax" x={PL - 8} y={sy(v) + 4} textAnchor="end">{v} %</text>
          </g>
        ))}
        <path className="fl" d={`${full}L${sx(X1)} ${H - PB}L${sx(X0)} ${H - PB}Z`} />
        <path className="cl" d={full} />
        {t != null && speed != null && (
          <>
            <line className="lv" x1={lx} x2={lx} y1={PT} y2={H - PB} />
            <circle className="lvd" cx={lx} cy={sy(curveAt(pts, t))} r={5} />
            <g className="tg">
              <rect x={tx - 62} y={PT + 2} width={124} height={24} rx={6} />
              <text x={tx} y={PT + 18} textAnchor="middle">{t} °C → {speed} %</text>
            </g>
          </>
        )}
        {pts.map((p, i) => (
          <circle key={i} className={`pt${drag === i ? ' on' : ''}`} cx={sx(p[0])} cy={sy(p[1])} r={8}
            tabIndex={disabled ? -1 : 0} role="slider" aria-label={`Point ${i + 1} : ${p[0]} °C, ${p[1]} %`}
            aria-valuenow={p[1]} aria-valuemin={0} aria-valuemax={100} aria-disabled={disabled || undefined}
            style={disabled ? { cursor: 'not-allowed' } : undefined}
            onPointerDown={e => {
              if (disabled) return;
              e.preventDefault();
              svg.current?.setPointerCapture(e.pointerId);
              setDrag(i);
            }}
            onKeyDown={e => {
              if (disabled) return;
              const k = e.key, [pt, pv] = p;
              const delta: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, 5], ArrowDown: [0, -5] };
              if (!delta[k]) return;
              e.preventDefault();
              onCommit?.(setPt(i, pt + delta[k][0], pv + delta[k][1]));
            }} />
        ))}
      </svg>
    </div>
  );
}
