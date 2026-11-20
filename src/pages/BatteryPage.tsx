// Page Batterie — pas de maquette dédiée : composée avec la grille et les pièces de
// « CpuScreen » et « DisksScreen » (la barre est réservée aux capacités : niveau, usure).
// Pour le niveau, c'est la valeur basse qui alerte : attention sous 20 %, critique sous 10 %.
import { Badge, Card, Empty, KeyValue, Legend, LevelBadge, Widget, type Status } from '../components/Card';
import { LiveChart } from '../components/LiveChart';
import { MetricCard } from '../components/MetricCard';
import { PageHeader } from '../components/Shell';
import { duration, num, withUnit } from '../lib/format';
import { BATTERY_LOW, level, levelLow, THRESHOLDS } from '../lib/levels';
import { normalized, tail, useLive } from '../lib/store';
import type { BatteryStatus } from '../lib/types';

const SPARK = 40;
const STATUS: Record<BatteryStatus, [string, Status]> = {
  charging: ['En charge', 'acc'],
  discharging: ['Sur batterie', 'acc'],
  full: ['Pleine', 'ok'],
  notCharging: ['Branchée, charge en pause', 'ok'],
  unknown: ['État inconnu', 'acc'],
};
const WEAR_WORDS = { ok: 'Bon', warn: 'Attention', crit: 'Critique' } as const;
const wh = (v: number | null) => (v != null ? withUnit(num(v, 1), 'Wh') : '—');

export function BatteryPage() {
  const { snap, info, times, get, historyMs } = useLive();
  if (!snap || !info) return <Empty>Lecture des capteurs…</Empty>;
  const b = snap.batteries[0];
  if (!b) {
    return (
      <>
        <PageHeader title="Batterie" sub={snap.acOnline ? 'Alimentation secteur' : ''} />
        <div className="sw-grid" style={{ gridTemplateRows: 'minmax(200px, 1fr)' }}>
          <Widget span={12}><Card title="Batterie"><Empty>{info.capabilities.battery.detail}</Empty></Card></Widget>
        </div>
      </>
    );
  }

  const [statusWord, statusS] = STATUS[b.status];
  const lv = levelLow(b.percent, BATTERY_LOW);
  const charging = b.status === 'charging';
  const wearLevel = b.wearPct != null ? level(b.wearPct, THRESHOLDS.batteryWear) : null;
  const sub = [b.manufacturer, b.model, b.technology].filter(Boolean).join(' · ') || b.id;

  const autonomy = b.timeLeftS != null ? duration(b.timeLeftS) : null;
  const autonomySub = b.timeLeftS != null ? (charging ? 'jusqu’à la charge complète' : 'avant épuisement')
    : b.status === 'discharging' ? 'estimation en cours' : 'secteur branché';

  return (
    <>
      <PageHeader title="Batterie" sub={sub} actions={<Badge s={statusS}>{statusWord}</Badge>} />
      <div className="sw-grid" style={{ gridTemplateRows: '128px 236px minmax(180px, 1fr)', minHeight: 'calc(128px + 236px + 180px + 2 * var(--space-4))' }}>
        <Widget span={3}>
          <MetricCard kind="bar" label="Niveau" pct={b.percent} th={BATTERY_LOW} lv={lv} value={num(b.percent)} unit="%"
            sub={b.energyNowWh != null ? wh(b.energyNowWh) : statusWord} />
        </Widget>
        <Widget span={3}>
          <MetricCard kind="text" label="Autonomie" pct={0} value={autonomy ?? '—'} sub={autonomySub} />
        </Widget>
        <Widget span={3}>
          <MetricCard kind="text" label="Puissance" pct={0} value={b.powerW != null ? num(b.powerW, 1) : '—'} unit={b.powerW != null ? 'W' : undefined}
            sub={b.powerW == null ? 'aucun échange' : charging ? 'en charge' : 'consommée'} series={normalized(tail(get('batPower'), SPARK))} />
        </Widget>
        <Widget span={3}>
          {b.wearPct != null ? (
            <MetricCard kind="bar" label="Usure" pct={b.wearPct} th={THRESHOLDS.batteryWear} value={num(b.wearPct)} unit="%"
              sub={b.cycles != null ? `${num(b.cycles)} cycles` : ''} />
          ) : (
            <MetricCard kind="text" label="Usure" pct={0} value="—" sub="capacité d’origine inconnue" />
          )}
        </Widget>

        <Widget span={8}>
          <Card title="Niveau et puissance" right={<Legend items={[{ name: 'Niveau', color: 'var(--accent)' }, { name: 'Puissance', color: 'var(--series-2)', style: 'd' }]} />}>
            <LiveChart label="Niveau de charge et puissance de la batterie" max={100} unit="%" times={times} spanMs={historyMs} series={[
              { name: 'Niveau', color: 'var(--accent)', values: get('batLevel') },
              { name: 'Puissance', color: 'var(--series-2)', values: get('batPower'), unit: 'W', dec: 1 },
            ]} />
          </Card>
        </Widget>
        <Widget span={4}>
          <Card title="Santé" right={wearLevel && <LevelBadge l={wearLevel} words={WEAR_WORDS} />}>
            <KeyValue rows={[
              ['Capacité actuelle', wh(b.energyFullWh)],
              ['Capacité d’origine', wh(b.energyDesignWh)],
              ['Usure', b.wearPct != null ? withUnit(num(b.wearPct, 1), '%') : '—'],
              ['Cycles de charge', b.cycles != null ? num(b.cycles) : 'Non exposé'],
            ]} />
          </Card>
        </Widget>

        <Widget span={6}>
          <Card title="État">
            <KeyValue rows={[
              ['Statut', statusWord],
              ['Secteur', snap.acOnline == null ? '—' : snap.acOnline ? 'Branché' : 'Débranché'],
              ['Énergie restante', wh(b.energyNowWh)],
              ['Tension', b.voltageV != null ? withUnit(num(b.voltageV, 2), 'V') : '—'],
              ['Limite de charge', b.chargeLimit != null ? withUnit(num(b.chargeLimit), '%') : 'Aucune'],
            ]} />
          </Card>
        </Widget>
        <Widget span={6}>
          <Card title="Informations">
            <KeyValue rows={[
              ['Fabricant', b.manufacturer ?? '—'],
              ['Modèle', b.model ?? '—'],
              ['Technologie', b.technology ?? '—'],
              ['Identifiant', b.id],
            ]} />
          </Card>
        </Widget>
      </div>
    </>
  );
}
