// Cadre de la fenêtre : barre de titre personnalisée, barre latérale, en-tête de page.
import type { ReactNode } from 'react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { inTauri } from '../lib/api';
import { bytes, NBSP } from '../lib/format';
import { Icon, type IconName } from './Icon';

export type PageId = 'home' | 'cpu' | 'gpu' | 'ram' | 'disk' | 'net' | 'proc' | 'bat' | 'fan' | 'boot' | 'alert' | 'cog';

/** Ordre et groupes des pages (README du design, « Mise en page »). */
export const PAGES: (readonly [PageId, string, IconName] | '|')[] = [
  ['home', 'Accueil', 'home'], '|',
  ['cpu', 'CPU', 'cpu'], ['gpu', 'GPU', 'gpu'], ['ram', 'Mémoire', 'ram'], ['disk', 'Disques', 'disk'], ['net', 'Réseau', 'net'], '|',
  ['proc', 'Processus & apps', 'proc'], ['bat', 'Batterie', 'bat'], ['fan', 'Ventilateurs', 'fan'], ['boot', 'Démarrage', 'boot'], '|',
  ['alert', 'Alertes', 'bell'], ['cog', 'Paramètres', 'cog'],
];

const win = () => (inTauri ? getCurrentWindow() : null);

export function Titlebar() {
  return (
    <div className="sw-titlebar" data-tauri-drag-region>
      <span className="sw-brand" data-tauri-drag-region>
        <span className="sw-logo"><Icon name="logo" size={15} /></span>SysWatch
      </span>
      <span className="sw-wc">
        <button type="button" aria-label="Réduire" onClick={() => win()?.minimize()}><Icon name="min" size={14} /></button>
        <button type="button" aria-label="Agrandir" onClick={() => win()?.toggleMaximize()}><Icon name="max" size={14} /></button>
        <button type="button" className="close" aria-label="Fermer" onClick={() => win()?.close()}><Icon name="x" size={14} /></button>
      </span>
    </div>
  );
}

export function Sidebar({ active, onNavigate, onToggle, alerts, selfMem }: {
  active: PageId; onNavigate: (p: PageId) => void; onToggle: () => void; alerts: number; selfMem: number | null;
}) {
  const mem = selfMem != null ? bytes(selfMem).join(NBSP) : '—';
  return (
    <nav className="sw-side" aria-label="Pages">
      {PAGES.map((p, i) =>
        p === '|' ? (
          <div key={i} className="sw-nav-sep" />
        ) : (
          <button key={p[0]} className="sw-nav-i" type="button" aria-current={p[0] === active ? 'page' : undefined} title={p[1]} onClick={() => onNavigate(p[0])}>
            <Icon name={p[2]} size={18} />
            <span className="l">{p[1]}</span>
            {p[0] === 'alert' && alerts > 0 && <span className="n" aria-label={`${alerts} alertes non lues`}>{alerts}</span>}
          </button>
        ),
      )}
      <div className="sw-side-foot">
        <button className="sw-nav-i" type="button" onClick={onToggle} title="Replier la barre latérale">
          <Icon name="panel" size={18} />
          <span className="l">Replier</span>
        </button>
        <div className="sw-self" title="Mémoire utilisée par SysWatch lui-même (processus et affichage)">
          <Icon name="ram" size={14} />
          <span className="l">SysWatch{NBSP}</span>
          <b>{mem}</b>
        </div>
      </div>
    </nav>
  );
}

export function PageHeader({ title, sub, actions }: { title: string; sub?: ReactNode; actions?: ReactNode }) {
  return (
    <header className="sw-head">
      <div>
        <h1 className="sw-h1">{title}</h1>
        <div className="sw-sub">{sub}</div>
      </div>
      <div className="sw-actions">{actions}</div>
    </header>
  );
}
