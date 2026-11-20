// Page Accueil — maquette « HomeScreen ». Étape 1 : cartes CPU et Mémoire et graphique
// d'activité. GPU, disque, réseau, processus, températures et alertes arrivent avec leurs
// collecteurs ; la grille personnalisable avec l'étape 7.
import { Card, Empty, Legend, Widget } from '../components/Card';
import { LiveChart } from '../components/LiveChart';
import { MetricCard } from '../components/MetricCard';
import { PageHeader } from '../components/Shell';
import { bytes, duration, ghz, NBSP, seconds, tempStr } from '../lib/format';
import { useSettings } from '../lib/settings';
import { tail, useLive } from '../lib/store';

const SPARK = 40;

export function HomePage() {
  const { snap, info, times, series, historyMs } = useLive();
  const { intervalMs, tempUnit } = useSettings();
  if (!snap || !info) return <Empty>Lecture des capteurs…</Empty>;
  const { cpu, memory } = snap;
  const ramPct = memory.total ? (memory.used / memory.total) * 100 : 0;
  const [used, usedUnit] = bytes(memory.used);

  return (
    <>
      <PageHeader title="Accueil" sub={`${info.osName} · allumé depuis ${duration(snap.uptimeS)} · mise à jour toutes les ${seconds(intervalMs / 1000)}`} />
      <div className="sw-grid" style={{ gridTemplateRows: '128px 232px' }}>
        <Widget span={3}>
          <MetricCard label="CPU" pct={cpu.usage} value={cpu.freqMhz != null ? ghz(cpu.freqMhz) : '—'} unit={cpu.freqMhz != null ? 'GHz' : undefined}
            sub={cpu.tempC != null ? tempStr(cpu.tempC, tempUnit) : ''} series={tail(series.cpu, SPARK)} />
        </Widget>
        <Widget span={3}>
          <MetricCard label="Mémoire" pct={ramPct} value={used} unit={usedUnit} sub={`/${NBSP}${bytes(memory.total, { trim: true }).join(NBSP)}`} series={tail(series.ram, SPARK)} />
        </Widget>
        <div className="c6" />
        <Widget span={8}>
          <Card title="Activité en temps réel" right={<Legend items={[{ name: 'CPU', color: 'var(--accent)' }, { name: 'Mémoire', color: 'var(--series-3)', style: 't' }]} />}>
            <LiveChart label="Activité CPU et mémoire" max={100} unit="%" times={times} spanMs={historyMs} series={[
              { name: 'CPU', color: 'var(--accent)', values: series.cpu },
              // La mémoire garde le 3e style (pointillés) : le 2e est réservé au GPU.
              { name: 'Mémoire', color: 'var(--series-3)', style: 't', values: series.ram },
            ]} />
          </Card>
        </Widget>
      </div>
    </>
  );
}
