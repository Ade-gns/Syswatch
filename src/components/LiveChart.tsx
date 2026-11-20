// Graphique temps réel (LiveChart du design), en SVG pur : historique glissant, grille
// `gridline`, axes `axis`. Série 1 pleine + aire, série 2 en tirets longs, série 3 en
// pointillés. Au survol : trait vertical, points, bulle listant chaque série ; le graphique
// se fige le temps du survol. L'abscisse suit les horodatages réels (intervalle variable).
import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { num, withUnit } from '../lib/format';

export interface ChartSeries {
  name: string;
  /** Couleur CSS, toujours un token : 'var(--accent)', 'var(--series-2)'… */
  color: string;
  values: number[];
  unit?: string;
  dec?: number;
  /** Style de trait imposé ; par défaut selon le rang (plein, tirets, pointillés). */
  style?: 'd' | 't';
}

interface Props {
  series: ChartSeries[];
  /** Horodatages (ms), alignés sur les valeurs. */
  times: number[];
  /** Largeur de la fenêtre affichée, en ms. */
  spanMs: number;
  /** Maximum fixe de l'axe Y ; sinon échelle automatique « ronde ». */
  max?: number;
  unit?: string;
  label: string;
}

const PL = 44, PR = 10, PT = 8, PB = 22;
const DASH = { d: '7 4', t: '2 4' } as const;
const dashOf = (s: ChartSeries, i: number) => (s.style ? DASH[s.style] : i === 1 ? DASH.d : i === 2 ? DASH.t : undefined);

/** Maximum automatique : 4 graduations sur un pas « rond » (1, 2, 2,5, 5 × 10ⁿ). */
function autoMax(series: ChartSeries[]) {
  let m = 1;
  series.forEach(s => s.values.forEach(v => { if (Number.isFinite(v) && v > m) m = v; }));
  const need = (m * 1.1) / 4;
  const e = Math.pow(10, Math.floor(Math.log10(need)));
  return ([1, 2, 2.5, 5, 10].map(k => k * e).find(k => k >= need) ?? 10 * e) * 4;
}

const spanLabel = (s: number) => (s >= 120 ? withUnit(`−${num(s / 60)}`, 'min') : withUnit(`−${num(s)}`, 's'));
const agoLabel = (s: number) => (s < 1 ? 'maintenant' : s >= 120 ? `il y a ${withUnit(num(s / 60), 'min')}` : `il y a ${withUnit(num(s), 's')}`);

export function LiveChart(props: Props) {
  const box = useRef<HTMLDivElement>(null);
  const tip = useRef<HTMLDivElement>(null);
  const clipId = 'clip' + useId().replace(/[^a-zA-Z0-9_-]/g, '');
  const [size, setSize] = useState({ w: 640, h: 160 });
  const [hover, setHover] = useState(-1);
  // Données figées pendant le survol.
  const frozen = useRef<Props | null>(null);
  const { series, times, spanMs, max, unit, label } = hover >= 0 && frozen.current ? frozen.current : props;

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const { w: W, h: H } = size;
  const iw = Math.max(1, W - PL - PR), ih = Math.max(1, H - PT - PB);
  const now = times[times.length - 1] ?? Date.now();
  const ym = max ?? autoMax(series);
  const X = (t: number) => PL + (1 - (now - t) / spanMs) * iw;
  const Y = (v: number) => PT + (1 - Math.min(v, ym) / ym) * ih;

  const path = (vals: number[]) => {
    let d = '', pen = false;
    vals.forEach((v, i) => {
      if (!Number.isFinite(v)) { pen = false; return; }
      d += `${pen ? 'L' : 'M'}${X(times[i]).toFixed(1)} ${Y(v).toFixed(1)}`;
      pen = true;
    });
    return d;
  };

  const onMove = (e: React.MouseEvent) => {
    if (times.length < 2) return;
    const r = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - r.left;
    if (x < PL || x > W - PR) { setHover(-1); return; }
    const t = now - (1 - (x - PL) / iw) * spanMs;
    let best = 0;
    times.forEach((ti, i) => { if (Math.abs(ti - t) < Math.abs(times[best] - t)) best = i; });
    if (hover < 0) frozen.current = props;
    setHover(best);
  };

  // Bulle : placée à droite du curseur, ou à gauche si elle déborde.
  useLayoutEffect(() => {
    const el = tip.current;
    if (!el || hover < 0) return;
    const x = X(times[hover]);
    el.style.left = `${x + 14 + el.offsetWidth > W ? x - 14 - el.offsetWidth : x + 14}px`;
  });

  const fmt = (s: ChartSeries, v: number) => (Number.isFinite(v) ? withUnit(num(v, s.dec ?? 0), s.unit ?? unit ?? '') : '—');
  const first = series[0];
  const firstPath = first ? path(first.values) : '';
  const firstIdx = first ? first.values.findIndex(Number.isFinite) : -1;

  return (
    <div className="sw-chart" ref={box} style={{ flex: 1 }} onMouseMove={onMove} onMouseLeave={() => setHover(-1)}>
      <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} role="img" aria-label={label}>
        <defs>
          <clipPath id={clipId}><rect x={PL} y={0} width={iw} height={H} /></clipPath>
        </defs>
        {[0, 1, 2, 3, 4].map(k => {
          const y = PT + (k / 4) * ih;
          return (
            <g key={k}>
              <line className="gl" x1={PL} x2={W - PR} y1={y} y2={y} />
              <text className="ax" x={PL - 8} y={y + 4} textAnchor="end">{num(ym * (1 - k / 4), ym < 10 ? 1 : 0)}</text>
            </g>
          );
        })}
        <text className="ax" x={PL} y={H - 5}>{spanLabel(spanMs / 1000)}</text>
        <text className="ax" x={PL + iw / 2} y={H - 5} textAnchor="middle">{spanLabel(spanMs / 2000)}</text>
        <text className="ax" x={W - PR} y={H - 5} textAnchor="end">maintenant</text>
        <g clipPath={`url(#${clipId})`}>
          {first && firstPath && firstIdx >= 0 && (
            <path className="ar" d={`${firstPath}L${X(now)} ${PT + ih}L${X(times[firstIdx])} ${PT + ih}Z`} style={{ fill: first.color }} />
          )}
          {series.map((s, i) => (
            <path key={s.name} className="ln" d={i === 0 ? firstPath : path(s.values)} style={{ stroke: s.color }} strokeDasharray={dashOf(s, i)} />
          ))}
        </g>
        {hover >= 0 && (
          <>
            <line className="cur" x1={X(times[hover])} x2={X(times[hover])} y1={PT} y2={PT + ih} />
            {series.map(s => Number.isFinite(s.values[hover]) && (
              <circle key={s.name} className="dot" cx={X(times[hover])} cy={Y(s.values[hover])} r={4.5} style={{ fill: s.color }} />
            ))}
          </>
        )}
      </svg>
      {hover >= 0 && (
        <div className="sw-tip" ref={tip}>
          <div className="tt">{agoLabel(Math.round((now - times[hover]) / 1000))}</div>
          {series.map(s => (
            <div className="r" key={s.name}>
              <span><i style={{ '--c': s.color } as React.CSSProperties} /> {s.name}</span>
              <b>{fmt(s, s.values[hover])}</b>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
