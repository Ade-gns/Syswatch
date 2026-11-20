// Cartes, badges, légendes et petites pièces de liste communes à toutes les pages.
import type { CSSProperties, ReactNode } from 'react';
import { level, LEVEL_WORD, type Level, type Thresholds } from '../lib/levels';
import { Bar } from './Gauges';

export function Card({ title, right, children, className = '', style }: {
  title: ReactNode; right?: ReactNode; children: ReactNode; className?: string; style?: CSSProperties;
}) {
  return (
    <div className={`sw-card ${className}`} style={style}>
      <div className="sw-card-h">
        <span className="sw-label">{title}</span>
        {right}
      </div>
      {children}
    </div>
  );
}

/** Cellule de la grille de 12 colonnes (3, 4, 5, 6, 7, 8 ou 12). */
export function Widget({ span, children }: { span: 3 | 4 | 5 | 6 | 7 | 8 | 12; children: ReactNode }) {
  return <div className={`sw-w c${span}`}>{children}</div>;
}

export type Status = 'ok' | 'warn' | 'crit' | 'acc';
export const Badge = ({ s, children }: { s: Status; children: ReactNode }) => <span className={`sw-badge s-${s}`}>{children}</span>;

/** Badge d'état d'une jauge : « Normal », « Attention », « Critique ». */
export const LevelBadge = ({ l, words = LEVEL_WORD }: { l: Level; words?: Record<Level, string> }) => <Badge s={l}>{words[l]}</Badge>;

export const Sec = ({ children }: { children: ReactNode }) => <span className="sw-sec">{children}</span>;

export type LegendItem = { name: string; color: string; style?: 'd' | 't' };
export function Legend({ items }: { items: LegendItem[] }) {
  return (
    <div className="sw-leg">
      {items.map(i => (
        <span key={i.name}>
          <i className={i.style ?? ''} style={{ '--c': i.color } as CSSProperties} />
          {i.name}
        </span>
      ))}
    </div>
  );
}

/** Ligne libellé + barre + valeur (températures, fréquences, top processus). */
export function MeterRow({ label, pct, th, value }: { label: string; pct: number; th: Thresholds; value: ReactNode }) {
  return (
    <div className="sw-row">
      <span>{label}</span>
      <span className={`l-${level(pct, th)}`}><Bar pct={pct} th={th} ticks={false} h={6} /></span>
      <span className="sw-mono">{value}</span>
    </div>
  );
}

export function KeyValue({ rows }: { rows: [string, ReactNode][] }) {
  return (
    <div className="sw-kv">
      {rows.map(([k, v]) => (
        <div key={k}><span>{k}</span><span>{v}</span></div>
      ))}
    </div>
  );
}

export function CoreBars({ values, th }: { values: number[]; th: Thresholds }) {
  const cols = Math.min(8, Math.ceil(values.length / 2)) || 1;
  return (
    <div className="sw-cores" style={{ gridTemplateColumns: `repeat(${cols}, 1fr)`, gridTemplateRows: `repeat(${Math.ceil(values.length / cols)}, 1fr)` }}>
      {values.map((v, i) => (
        <div key={i} className={`sw-core l-${level(v, th)}`}>
          <b>{Math.round(v)}</b>
          <div className="tr"><i style={{ height: `${Math.max(3, v)}%` }} /></div>
          <span>{i}</span>
        </div>
      ))}
    </div>
  );
}

/** État vide ou fonction non prise en charge, avec sa raison. */
export const Empty = ({ children }: { children: ReactNode }) => <div className="sw-empty">{children}</div>;
