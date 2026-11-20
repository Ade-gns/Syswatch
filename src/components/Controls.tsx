// Contrôles de base du design : interrupteur et bouton segmenté.
import type { ReactNode } from 'react';
import { Icon, type IconName } from './Icon';

export function Switch({ on, label, onChange }: { on: boolean; label: string; onChange: (v: boolean) => void }) {
  return <button className="sw-switch" type="button" role="switch" aria-checked={on} aria-label={label} onClick={() => onChange(!on)} />;
}

export interface SegItem<T extends string> { value: T; label: ReactNode; icon?: IconName }

export function Segmented<T extends string>({ items, value, onChange, label }: {
  items: SegItem<T>[]; value: T; onChange: (v: T) => void; label?: string;
}) {
  return (
    <div className="sw-seg" role="group" aria-label={label}>
      {items.map(i => (
        <button key={i.value} type="button" aria-pressed={i.value === value} onClick={() => onChange(i.value)}>
          {i.icon && <Icon name={i.icon} size={15} />}
          {i.label}
        </button>
      ))}
    </div>
  );
}

/** Ligne de réglage : libellé + description à gauche, contrôle à droite. */
export function SettingRow({ title, desc, children }: { title: string; desc?: string; children: ReactNode }) {
  return (
    <div className="sw-set">
      <div>
        <div>{title}</div>
        {desc && <div className="d">{desc}</div>}
      </div>
      {children}
    </div>
  );
}
