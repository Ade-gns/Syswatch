// Page Alertes — pas de maquette de page : lignes de réglage (libellé + contrôles à droite)
// de « SettingsScreen », lignes d'alerte (« sw-alert-r ») de la carte « Alertes récentes »
// de l'Accueil. Les seuils réglés ici sont aussi ceux de toutes les jauges (README : « Un
// seuil se règle par métrique, dans la page Alertes »).
import { useEffect, useState } from 'react';
import { Card, Empty, Sec, Widget } from '../components/Card';
import { SettingRow, Switch } from '../components/Controls';
import { Icon, type IconName } from '../components/Icon';
import { PageHeader } from '../components/Shell';
import { useAlerts } from '../lib/alerts';
import { be } from '../lib/api';
import { num } from '../lib/format';
import { updateSettings, useSettings } from '../lib/settings';
import type { AlertEvent, AlertRule, AlertRuleId } from '../lib/types';

const RULES: Record<AlertRuleId, { title: string; desc: string; unit: '°C' | '%'; max: number }> = {
  cpuTemp: { title: 'Température CPU', desc: 'Sonde du processeur (Tctl, Package)', unit: '°C', max: 110 },
  gpuTemp: { title: 'Température GPU', desc: 'GPU le plus chaud', unit: '°C', max: 110 },
  ssdTemp: { title: 'Température SSD', desc: 'SSD NVMe et disques avec sonde', unit: '°C', max: 110 },
  ram: { title: 'Mémoire', desc: 'Sert aussi aux jauges de charge CPU et GPU', unit: '%', max: 100 },
  disk: { title: 'Espace disque', desc: 'Chaque partition montée', unit: '%', max: 100 },
};

export const alertIcon = (e: AlertEvent): IconName => (e.rule === 'disk' ? 'disk' : e.rule === 'ram' ? 'ram' : e.level === 'crit' ? 'warn' : 'temp');

export function alertTime(t: number) {
  const d = new Date(t * 1000);
  const today = new Date().toDateString() === d.toDateString();
  const hm = d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  return today ? hm : `${d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })} ${hm}`;
}

export function AlertRow({ e }: { e: AlertEvent }) {
  return (
    <div className={`sw-alert-r s-${e.level === 'crit' ? 'crit' : 'warn'}`}>
      <span className="ico"><Icon name={alertIcon(e)} size={15} /></span>
      <span>{e.text}</span>
      <span className="sw-sec">{alertTime(e.t)}</span>
    </div>
  );
}

/** Champ numérique validé à la sortie du champ (ou Entrée). */
function NumInput({ value, unit, max, label, onCommit }: { value: number; unit: string; max: number; label: string; onCommit: (v: number) => void }) {
  const [v, setV] = useState(String(value));
  useEffect(() => setV(String(value)), [value]);
  const commit = () => {
    const n = Math.round(Number(v.replace(',', '.')));
    if (Number.isFinite(n) && n >= 1 && n <= max) onCommit(n);
    else setV(String(value));
  };
  return (
    <span className="sw-numin">
      <input className="sw-input" inputMode="numeric" aria-label={label} value={v} onChange={e => setV(e.target.value)} onBlur={commit} onKeyDown={e => e.key === 'Enter' && (e.target as HTMLInputElement).blur()} />
      <small>{unit}</small>
    </span>
  );
}

export function AlertsPage() {
  const s = useSettings();
  const { history, unread } = useAlerts();
  // Ouvrir la page vaut lecture : la pastille de la barre latérale disparaît.
  useEffect(() => { if (unread > 0) be().markAlertsRead(); }, [unread]);

  const setRule = (id: AlertRuleId, patch: Partial<AlertRule>) => {
    const rules = s.alerts.rules.map(r => {
      if (r.id !== id) return r;
      const n = { ...r, ...patch };
      if (patch.warn != null && n.crit < n.warn) n.crit = n.warn;
      if (patch.crit != null && n.warn > n.crit) n.warn = n.crit;
      return n;
    });
    updateSettings({ alerts: { ...s.alerts, rules } });
  };
  const today = history.filter(e => new Date(e.t * 1000).toDateString() === new Date().toDateString()).length;

  return (
    <>
      <PageHeader title="Alertes" sub={`${today} alerte${today > 1 ? 's' : ''} aujourd’hui · notifications ${s.alerts.notify ? 'activées' : 'désactivées'}`}
        actions={history.length > 0 && <button type="button" className="sw-btn" onClick={() => be().clearAlerts()}><Icon name="x" size={15} />Effacer l’historique</button>} />
      <div className="sw-grid" style={{ gridTemplateColumns: '7fr 5fr', gridTemplateRows: 'minmax(0, 1fr)' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)', minWidth: 0 }}>
          <Widget span={12}>
            <Card title="Seuils" right={<Sec>Attention · Critique</Sec>}>
              {s.alerts.rules.map(r => {
                const meta = RULES[r.id];
                return (
                  <SettingRow key={r.id} title={meta.title} desc={meta.desc}>
                    <span className="sw-inl" style={{ gap: 'var(--space-3)' }}>
                      <NumInput value={r.warn} unit={meta.unit} max={meta.max} label={`${meta.title} : seuil d’attention`} onCommit={v => setRule(r.id, { warn: v })} />
                      <NumInput value={r.crit} unit={meta.unit} max={meta.max} label={`${meta.title} : seuil critique`} onCommit={v => setRule(r.id, { crit: v })} />
                      <Switch on={r.enabled} label={`Surveiller : ${meta.title}`} onChange={on => setRule(r.id, { enabled: on })} />
                    </span>
                  </SettingRow>
                );
              })}
            </Card>
          </Widget>
          <Widget span={12}>
            <Card title="Notifications">
              <SettingRow title="Notifications de bureau" desc="Pour les alertes critiques, même fenêtre fermée">
                <Switch on={s.alerts.notify} label="Notifications de bureau" onChange={v => updateSettings({ alerts: { ...s.alerts, notify: v } })} />
              </SettingRow>
              <SettingRow title="Notifier aussi « Attention »" desc="Sinon, ces alertes vont seulement dans l’historique">
                <Switch on={s.alerts.notifyWarn} label="Notifier aussi le niveau Attention" onChange={v => updateSettings({ alerts: { ...s.alerts, notifyWarn: v } })} />
              </SettingRow>
            </Card>
          </Widget>
        </div>
        <div style={{ display: 'flex', minWidth: 0, minHeight: 0 }}>
          <Card className="flex-1" title="Historique" right={<Sec>{history.length ? `${num(history.length)} alerte${history.length > 1 ? 's' : ''}` : 'depuis le lancement'}</Sec>}>
            {history.length === 0 ? <Empty>Aucune alerte depuis le lancement de SysWatch.</Empty> : (
              <div className="sw-rows scroll" style={{ gap: 4 }}>
                {history.map(e => <AlertRow key={e.seq} e={e} />)}
              </div>
            )}
          </Card>
        </div>
      </div>
    </>
  );
}
