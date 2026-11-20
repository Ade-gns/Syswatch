// Page GPU — pas de maquette dédiée : composée uniquement avec les pièces et la grille de la
// maquette « CpuScreen » (4 cartes de métrique, courbe 8 colonnes + carte 4 colonnes, puis
// cartes de liste) et le sélecteur segmenté de « DisksScreen » quand il y a plusieurs GPU.
import { useState } from 'react';
import { Badge, Card, Empty, KeyValue, Legend, LevelBadge, MeterRow, Sec, Widget } from '../components/Card';
import { Segmented } from '../components/Controls';
import { LiveChart } from '../components/LiveChart';
import { MetricCard } from '../components/MetricCard';
import { PageHeader } from '../components/Shell';
import { bytes, mhz, NBSP, num, temp, tempStr, withUnit } from '../lib/format';
import { gpuSensors, gpuStateWord, orderedGpus } from '../lib/gpu';
import { level, NO_THRESHOLD, THRESHOLDS, worst } from '../lib/levels';
import { useSettings } from '../lib/settings';
import { gpuKey, normalized, tail, useLive } from '../lib/store';

const SPARK = 40;
const TEMP_WORDS = { ok: 'Température normale', warn: 'Température élevée', crit: 'Température critique' } as const;

export function GpuPage() {
  const { snap, info, times, get, peaks, historyMs } = useLive();
  const { tempUnit } = useSettings();
  const [sel, setSel] = useState<string | null>(null);
  if (!snap || !info) return <Empty>Lecture des capteurs…</Empty>;

  const gpus = orderedGpus(info.gpus);
  if (!gpus.length) {
    return (
      <>
        <PageHeader title="GPU" sub="Aucun processeur graphique détecté" />
        <Card title="GPU" className="flex-1"><Empty>Aucune carte graphique n'a été trouvée dans /sys/class/drm.</Empty></Card>
      </>
    );
  }
  const gi = gpus.find(g => g.id === sel) ?? gpus[0];
  const g = snap.gpus.find(x => x.id === gi.id);
  const active = g?.state === 'active';
  const kind = gi.integrated ? 'intégré' : 'dédié';
  const sub = [gi.name, `${gi.vendor}${gi.driverVersion ? ` ${gi.driverVersion}` : ` · ${gi.driver}`}`, `GPU ${kind}`].join(' · ');

  const selector = gpus.length > 1 && (
    <Segmented label="Choix du GPU" value={gi.id} onChange={setSel}
      items={gpus.map(x => ({ value: x.id, label: x.integrated ? 'Intégré' : x.name }))} />
  );
  const tempLevel = active && g.tempC != null ? level(g.tempC, THRESHOLDS.gpuTemp) : null;
  const stateBadge = !active ? <Badge s={g?.state === 'sleeping' ? 'acc' : 'warn'}>{gpuStateWord(g?.state)}</Badge>
    : tempLevel && <LevelBadge l={tempLevel} words={TEMP_WORDS} />;

  const header = <PageHeader title="GPU" sub={sub} actions={<>{stateBadge}{selector}</>} />;
  const infoCard = (
    <Card title="Informations">
      <KeyValue rows={[
        ['Modèle', gi.name],
        ['Type', gi.integrated ? 'Intégré au processeur' : 'Carte dédiée'],
        ['Pilote', gi.driverVersion ? `${gi.driver} ${gi.driverVersion}` : gi.driver],
        ['Bus PCI', gi.id],
        ['Fréquence max.', gi.maxCoreMhz ? mhz(gi.maxCoreMhz) : '—'],
        ['Processus actifs', g?.processes != null ? num(g.processes) : '—'],
        ['Limite de puissance', gi.powerLimitW ? withUnit(num(gi.powerLimitW), 'W') : gi.powerShared ? 'Partagée avec le CPU' : '—'],
      ]} />
    </Card>
  );

  if (!active) {
    return (
      <>
        {header}
        <div className="sw-grid" style={{ gridTemplateRows: 'minmax(220px, 1fr)' }}>
          <Widget span={8}><Card title="État"><Empty>{g?.detail ?? 'GPU non disponible'}</Empty></Card></Widget>
          <Widget span={4}>{infoCard}</Widget>
        </div>
      </>
    );
  }

  const usage = g.usage ?? 0;
  const vramPct = g.vramUsed != null && g.vramTotal ? (g.vramUsed / g.vramTotal) * 100 : 0;
  const [vu, vuUnit] = bytes(g.vramUsed ?? 0);
  const sensors = gpuSensors(snap.sensors, gi);
  const sensorsLevel = worst(sensors.map(s => level(s.valueC, THRESHOLDS.gpuTemp)));
  const tPeak = peaks[gpuKey(gi.id, 'temp')];
  const fans = [g.fanRpm != null && ['Ventilateur', withUnit(num(g.fanRpm), 'tr/min')] as const, g.fanPct != null && ['Consigne ventilateur', withUnit(num(g.fanPct), '%')] as const].filter(Boolean) as [string, string][];

  return (
    <>
      {header}
      <div className="sw-grid" style={{ gridTemplateRows: '128px 236px minmax(200px, 1fr)', minHeight: 'calc(128px + 236px + 200px + 2 * var(--space-4))' }}>
        <Widget span={3}>
          {g.usage != null ? (
            <MetricCard label="Charge" pct={usage} value={g.coreMhz != null ? num(g.coreMhz) : '—'} unit={g.coreMhz != null ? 'MHz' : undefined}
              sub={gi.maxCoreMhz ? `max ${num(gi.maxCoreMhz)}` : ''} series={tail(get(gpuKey(gi.id, 'usage')), SPARK)} />
          ) : (
            <MetricCard kind="text" label="Charge" pct={0} value="—" sub="Non disponible" title={g.detail ?? undefined} />
          )}
        </Widget>
        <Widget span={3}>
          {g.tempC != null ? (
            <MetricCard kind="bar" label="Température" pct={g.tempC} th={THRESHOLDS.gpuTemp} value={temp(g.tempC, tempUnit)[0]} unit={temp(g.tempC, tempUnit)[1]}
              sub={tPeak != null ? `pic ${tempStr(tPeak, tempUnit)}` : ''} />
          ) : (
            <MetricCard kind="text" label="Température" pct={0} value="—" sub="Non disponible" />
          )}
        </Widget>
        <Widget span={3}>
          {g.vramTotal ? (
            <MetricCard kind="bar" label={gi.integrated ? 'Mémoire réservée' : 'Mémoire vidéo'} pct={vramPct} value={vu} unit={vuUnit}
              sub={`/${NBSP}${bytes(g.vramTotal, { trim: true }).join(NBSP)}`} />
          ) : (
            <MetricCard kind="text" label="Mémoire vidéo" pct={0} value="—" sub="Non disponible" />
          )}
        </Widget>
        <Widget span={3}>
          {g.powerW != null ? (
            <MetricCard kind="text" label="Puissance" pct={0} value={num(g.powerW, g.powerW < 10 ? 1 : 0)} unit="W"
              sub={gi.powerShared ? 'SoC, partagée avec le CPU' : gi.powerLimitW ? `limite ${withUnit(num(gi.powerLimitW), 'W')}` : ''}
              series={normalized(tail(get(gpuKey(gi.id, 'power')), SPARK))} />
          ) : (
            <MetricCard kind="text" label="Puissance" pct={0} value="—" sub="Non disponible" />
          )}
        </Widget>

        <Widget span={8}>
          <Card title="Charge GPU" right={<Legend items={[{ name: 'Charge', color: 'var(--accent)' }, { name: 'Température', color: 'var(--series-2)', style: 'd' }]} />}>
            <LiveChart label="Charge et température du GPU" max={100} unit="%" times={times} spanMs={historyMs} series={[
              { name: 'Charge', color: 'var(--accent)', values: get(gpuKey(gi.id, 'usage')) },
              { name: 'Température', color: 'var(--series-2)', values: get(gpuKey(gi.id, 'temp')), unit: '°C' },
            ]} />
          </Card>
        </Widget>
        <Widget span={4}>
          <Card title="Fréquences" right={<Sec>MHz</Sec>}>
            <div className="sw-rows">
              <MeterRow label="Cœur graphique" pct={g.coreMhz != null && gi.maxCoreMhz ? (g.coreMhz / gi.maxCoreMhz) * 100 : 0} th={NO_THRESHOLD} value={g.coreMhz != null ? num(g.coreMhz) : '—'} />
              <MeterRow label="Mémoire" pct={g.memMhz != null && gi.maxMemMhz ? (g.memMhz / gi.maxMemMhz) * 100 : 0} th={NO_THRESHOLD} value={g.memMhz != null ? num(g.memMhz) : '—'} />
              <MeterRow label="Mémoire utilisée" pct={vramPct} th={THRESHOLDS.load} value={withUnit(num(vramPct), '%')} />
            </div>
          </Card>
        </Widget>

        <Widget span={6}>
          <Card title="Températures" right={sensors.length > 0 && <LevelBadge l={sensorsLevel} />}>
            {sensors.length ? (
              <div className="sw-rows" style={{ justifyContent: 'flex-start' }}>
                {sensors.map(s => <MeterRow key={s.id} label={s.label} pct={s.valueC} th={THRESHOLDS.gpuTemp} value={tempStr(s.valueC, tempUnit)} />)}
                {fans.map(([k, v]) => <div key={k} className="sw-row"><span>{k}</span><span /><span className="sw-mono">{v}</span></div>)}
              </div>
            ) : (
              <Empty>Aucun capteur de température exposé par ce pilote.</Empty>
            )}
          </Card>
        </Widget>
        <Widget span={6}>{infoCard}</Widget>
      </div>
    </>
  );
}
