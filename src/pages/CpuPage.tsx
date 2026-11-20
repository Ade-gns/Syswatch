// Page CPU — maquette « CpuScreen » : charge, température, fréquence, puissance ; courbe de
// charge ; charge par thread ; températures ; fréquence par cœur ; informations.
import { Card, CoreBars, Empty, KeyValue, Legend, LevelBadge, MeterRow, Sec, Widget } from '../components/Card';
import { LiveChart } from '../components/LiveChart';
import { MetricCard } from '../components/MetricCard';
import { PageHeader } from '../components/Shell';
import { duration, ghz, num, shortCpuName, temp, tempStr, withUnit } from '../lib/format';
import { level, NO_THRESHOLD, THRESHOLDS, worst } from '../lib/levels';
import { useSettings } from '../lib/settings';
import { normalized, tail, useLive } from '../lib/store';

const SPARK = 40;
const TEMP_WORDS = { ok: 'Température normale', warn: 'Température élevée', crit: 'Température critique' } as const;

export function CpuPage() {
  const { snap, info, times, series, historyMs } = useLive();
  const { tempUnit } = useSettings();
  if (!snap || !info) return <Empty>Lecture des capteurs…</Empty>;
  const { cpu } = snap;
  const ci = info.cpu;
  const caps = info.capabilities;

  const tempTh = THRESHOLDS.cpuTemp;
  const tempLevel = cpu.tempC != null ? level(cpu.tempC, tempTh) : null;
  const sensorTh = (label: string) => (/package|cœur|Tccd/i.test(label) ? tempTh : THRESHOLDS.tempDefault);
  const sensorsLevel = worst(cpu.sensors.map(s => level(s.valueC, sensorTh(s.label))));
  const maxMhz = ci.maxFreqMhz ?? Math.max(1, ...cpu.perCoreFreqMhz);
  const tempLabel = caps.cpuTemp.detail.split(' · ')[1] ?? 'CPU';

  return (
    <>
      <PageHeader
        title="CPU"
        sub={`${shortCpuName(ci.model)} · ${ci.physicalCores} cœurs / ${ci.logicalCpus} threads`}
        actions={tempLevel && <LevelBadge l={tempLevel} words={TEMP_WORDS} />}
      />
      <div className="sw-grid" style={{ gridTemplateRows: '128px 236px minmax(220px, 1fr)', minHeight: 'calc(128px + 236px + 220px + 2 * var(--space-4))' }}>
        <Widget span={3}>
          <MetricCard label="Charge" pct={cpu.usage} value={num(cpu.processes)} unit="processus"
            sub={`${ci.logicalCpus} threads`} series={tail(series.cpu, SPARK)} />
        </Widget>
        <Widget span={3}>
          {cpu.tempC != null ? (
            <MetricCard kind="bar" label="Température" pct={cpu.tempC} th={tempTh} value={temp(cpu.tempC, tempUnit)[0]} unit={temp(cpu.tempC, tempUnit)[1]}
              sub={`${tempLabel} · pic ${tempStr(cpu.tempPeakC ?? cpu.tempC, tempUnit)}`} />
          ) : (
            <MetricCard kind="text" label="Température" pct={0} value="—" sub="Non disponible" title={caps.cpuTemp.detail} />
          )}
        </Widget>
        <Widget span={3}>
          <MetricCard kind="text" label="Fréquence" pct={0} th={NO_THRESHOLD}
            value={cpu.freqMhz != null ? ghz(cpu.freqMhz) : '—'} unit={cpu.freqMhz != null ? 'GHz' : undefined}
            sub={ci.maxFreqMhz ? `max ${withUnit(ghz(ci.maxFreqMhz), 'GHz')}` : 'moyenne des cœurs'}
            series={tail(series.cpuFreqPct, SPARK)} title={caps.cpuFreq.detail} />
        </Widget>
        <Widget span={3}>
          {cpu.powerW != null ? (
            <MetricCard kind="text" label="Puissance" pct={0} value={num(cpu.powerW)} unit="W" sub={caps.cpuPower.detail.replace(' (amdgpu)', '')}
              series={normalized(tail(series.cpuPower, SPARK))} title={`Source : ${caps.cpuPower.detail}`} />
          ) : (
            <MetricCard kind="text" label="Puissance" pct={0} value="—" sub="Non disponible" title={caps.cpuPower.detail} />
          )}
        </Widget>

        <Widget span={8}>
          <Card title="Charge CPU" right={<Legend items={[{ name: 'Total', color: 'var(--accent)' }, { name: 'Thread le plus chargé', color: 'var(--series-2)', style: 'd' }]} />}>
            <LiveChart label="Charge CPU" max={100} unit="%" times={times} spanMs={historyMs} series={[
              { name: 'Total', color: 'var(--accent)', values: series.cpu },
              { name: 'Thread le plus chargé', color: 'var(--series-2)', values: series.cpuMaxThread },
            ]} />
          </Card>
        </Widget>
        <Widget span={4}>
          <Card title="Charge par thread" right={<Sec>% par thread</Sec>}>
            <CoreBars values={cpu.perThread} th={THRESHOLDS.load} />
          </Card>
        </Widget>

        <Widget span={4}>
          <Card title="Températures" right={cpu.sensors.length > 0 && <LevelBadge l={sensorsLevel} />}>
            {cpu.sensors.length ? (
              <div className="sw-rows">
                {cpu.sensors.map(s => (
                  <MeterRow key={s.label} label={s.label} pct={s.valueC} th={sensorTh(s.label)} value={tempStr(s.valueC, tempUnit)} />
                ))}
              </div>
            ) : (
              <Empty>{caps.cpuTemp.detail}</Empty>
            )}
          </Card>
        </Widget>
        <Widget span={4}>
          <Card title="Fréquence par cœur" right={<Sec>GHz</Sec>}>
            {cpu.perCoreFreqMhz.length ? (
              <div className={`sw-rows${cpu.perCoreFreqMhz.length > 6 ? ' scroll' : ''}`}>
                {cpu.perCoreFreqMhz.map((f, i) => (
                  <MeterRow key={i} label={`Cœur ${i}`} pct={(f / maxMhz) * 100} th={NO_THRESHOLD} value={ghz(f)} />
                ))}
              </div>
            ) : (
              <Empty>{caps.cpuFreq.detail}</Empty>
            )}
          </Card>
        </Widget>
        <Widget span={4}>
          <Card title="Informations">
            <KeyValue rows={[
              ['Modèle', shortCpuName(ci.model)],
              ['Cache L3', ci.l3CacheKb ? withUnit(num(ci.l3CacheKb / 1024), 'Mo') : '—'],
              ['Pilote', ci.driver ?? '—'],
              ['Gouverneur', ci.governor ?? '—'],
              ['Profil EPP', ci.epp ?? '—'],
              ['Allumé depuis', duration(snap.uptimeS)],
            ]} />
          </Card>
        </Widget>
      </div>
    </>
  );
}

