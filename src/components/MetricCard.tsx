// Carte de métrique (MetricCard du design) : jauge circulaire, barre à repères, ou valeur +
// mini-courbe. Une carte = une grandeur. La valeur reste en couleur `text`.
import type { ReactNode } from 'react';
import { level, LEVEL_WORD, NO_THRESHOLD, THRESHOLDS, type Level, type Thresholds } from '../lib/levels';
import { Badge } from './Card';
import { Bar, Ring, Spark } from './Gauges';

interface Props {
  kind?: 'ring' | 'bar' | 'text';
  label: string;
  /** Pourcentage de la jauge (0–100). */
  pct: number;
  th?: Thresholds;
  value: ReactNode;
  unit?: string;
  sub?: ReactNode;
  series?: number[];
  /** Info-bulle (par ex. raison d'une mesure indisponible). */
  title?: string;
  /** Niveau imposé (batterie : c'est la valeur basse qui alerte). */
  lv?: Level;
}

export function MetricCard({ kind = 'ring', label, pct, th, value, unit, sub, series, title, lv }: Props) {
  const t = th ?? (kind === 'text' ? NO_THRESHOLD : THRESHOLDS.load);
  const l = lv ?? level(pct, t);
  const val = <div className="sw-val">{value}{unit && <small>{unit}</small>}</div>;
  const spark = series ? <Spark values={series} min={0} max={100} h={30} /> : null;

  if (kind === 'text') {
    return (
      <div className={`sw-card sw-metric bar l-${l}`} title={title}>
        <div className="t"><span className="sw-label">{label}</span><span className="sw-sec">{sub}</span></div>
        {val}
        {spark}
      </div>
    );
  }
  if (kind === 'ring') {
    return (
      <div className={`sw-card sw-metric l-${l}`} title={title}>
        <Ring pct={pct} size={76} stroke={8} th={t} label={label} />
        <div className="m">
          <div className="t"><span className="sw-label">{label}</span><span className="sw-sec">{sub}</span></div>
          {val}
          {spark}
        </div>
      </div>
    );
  }
  return (
    <div className={`sw-card sw-metric bar l-${l}`} title={title}>
      <div className="t"><span className="sw-label">{label}</span><Badge s={l}>{LEVEL_WORD[l]}</Badge></div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>{val}<span className="sw-sec">{sub}</span></div>
      <Bar pct={pct} th={t} lv={l} />
    </div>
  );
}
