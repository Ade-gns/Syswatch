// Page Accueil — maquette « HomeScreen ». Chaque widget est à sa place dans la maquette ;
// les emplacements encore vides (disque, réseau, processus, alertes) se remplissent avec
// leurs collecteurs, et la grille devient personnalisable à l'étape 7.
import { Badge, Card, Empty, Legend, LevelBadge, MeterRow, Sec, Widget } from '../components/Card';
import { Spark } from '../components/Gauges';
import { Icon } from '../components/Icon';
import { LiveChart } from '../components/LiveChart';
import { MetricCard } from '../components/MetricCard';
import { PageHeader } from '../components/Shell';
import { be } from '../lib/api';
import { bytes, duration, storage, ghz, NBSP, num, rate, seconds, temp, tempStr, withUnit } from '../lib/format';
import { gpuStateWord, mainGpu } from '../lib/gpu';
import { level, NO_THRESHOLD, sensorThresholds, THRESHOLDS, worst } from '../lib/levels';
import { usePoll } from '../lib/poll';
import { useSettings } from '../lib/settings';
import { gpuKey, tail, useLive } from '../lib/store';
import type { NetworkSnapshot, ProcessList, SensorKind, SensorReading, Snapshot } from '../lib/types';

const SPARK = 40;
/** Une ligne par famille, dans l'ordre de la maquette : CPU, GPU, SSD, carte mère, batterie. */
const HOME_KINDS: SensorKind[] = ['cpu', 'gpu', 'ssd', 'board', 'battery', 'ram'];

function homeSensors(all: SensorReading[]) {
  const rows: SensorReading[] = [];
  for (const k of HOME_KINDS) {
    // Le plus chaud de la famille : c'est lui qui compte pour l'état.
    const s = all.filter(x => x.kind === k).sort((a, b) => b.valueC - a.valueC)[0];
    if (s) rows.push(s.kind === 'gpu' || s.kind === 'ssd' || s.kind === 'cpu' ? { ...s, label: s.label.split(' · ')[0] } : s);
  }
  return rows.slice(0, 5);
}

/** Les 5 plus gros consommateurs de CPU : applications regroupées, autres processus seuls. */
function topCpu(l: ProcessList) {
  const loose = l.processes.filter(p => !p.app).map(p => ({ key: `p${p.pid}`, name: p.name, cpu: p.cpu }));
  return [...l.apps.map(a => ({ key: `a${a.id}`, name: a.name, cpu: a.cpu })), ...loose].sort((a, b) => b.cpu - a.cpu).slice(0, 5);
}

const band = (mhz: number) => (mhz >= 5925 ? '6 GHz' : mhz >= 4900 ? '5 GHz' : '2,4 GHz');

function NetCard({ n, rx }: { n: NetworkSnapshot; rx: number[] }) {
  const [r, ru] = rate(n.rxBps);
  const [t, tu] = rate(n.txBps);
  const big = { fontSize: 24, lineHeight: '30px' };
  const w = n.wifi;
  return (
    <Card title="Réseau" right={<Badge s={n.connected ? 'ok' : 'crit'}>{n.connected ? 'Connecté' : 'Déconnecté'}</Badge>}>
      <div className="sw-net">
        <div><span className="sw-sec"><Icon name="down" size={13} /> Réception</span><div className="sw-val md" style={big}>{r}<small>{ru}</small></div></div>
        <div><span className="sw-sec"><Icon name="up" size={13} /> Émission</span><div className="sw-val md" style={big}>{t}<small>{tu}</small></div></div>
      </div>
      <div className="l-ok"><Spark values={rx} min={0} h={44} /></div>
      <div className="sw-foot sw-sec">
        <span>{n.pingMs != null ? `Ping ${withUnit(num(n.pingMs), 'ms')}` : 'Ping —'}</span>
        {w && <span style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--space-1)' }}><Icon name="wifi" size={12} /> Wi‑Fi {w.freqMhz ? band(w.freqMhz) : ''}{w.signalDbm != null ? ` · −${Math.abs(w.signalDbm)}${NBSP}dBm` : ''}</span>}
      </div>
    </Card>
  );
}

/** Carte « Disque /home » de la maquette : système de fichiers de /home, sinon /. */
function HomeDisk({ snap }: { snap: Snapshot }) {
  const mounts = snap.disks.flatMap(d => d.mounts);
  const m = mounts.find(x => x.targets.includes('/home')) ?? mounts.find(x => x.targets.includes('/')) ?? mounts[0];
  if (!m) return <MetricCard kind="text" label="Disque" pct={0} value="—" sub="Aucun montage" />;
  const target = m.targets.includes('/home') ? '/home' : m.targets[0];
  const [u, uu] = storage(m.used);
  return <MetricCard kind="bar" label={`Disque ${target}`} pct={m.total ? (m.used / m.total) * 100 : 0} th={THRESHOLDS.disk} value={u} unit={uu} sub={`/${NBSP}${storage(m.total, { trim: true }).join(NBSP)}`} />;
}

export function HomePage() {
  const procs = usePoll(() => be().listProcesses(false), 2000).data;
  const { snap, info, times, series, get, historyMs } = useLive();
  const { intervalMs, tempUnit } = useSettings();
  if (!snap || !info) return <Empty>Lecture des capteurs…</Empty>;
  const { cpu, memory } = snap;
  const ramPct = memory.total ? (memory.used / memory.total) * 100 : 0;
  const [used, usedUnit] = bytes(memory.used);
  const gpu = mainGpu(info, snap);
  const gs = gpu?.snap;
  const temps = homeSensors(snap.sensors);
  const tempsLevel = worst(temps.map(s => level(s.valueC, sensorThresholds(s.kind))));

  return (
    <>
      <PageHeader title="Accueil" sub={`${info.osName} · allumé depuis ${duration(snap.uptimeS)} · mise à jour toutes les ${seconds(intervalMs / 1000)}`} />
      <div className="sw-grid" style={{ gridTemplateRows: '128px 232px minmax(200px, 1fr)', minHeight: 'calc(128px + 232px + 200px + 2 * var(--space-4))' }}>
        <Widget span={3}>
          <MetricCard label="CPU" pct={cpu.usage} value={cpu.freqMhz != null ? ghz(cpu.freqMhz) : '—'} unit={cpu.freqMhz != null ? 'GHz' : undefined}
            sub={cpu.tempC != null ? tempStr(cpu.tempC, tempUnit) : ''} series={tail(series.cpu, SPARK)} />
        </Widget>
        <Widget span={3}>
          {gpu && gs?.state === 'active' && gs.usage != null ? (
            <MetricCard label="GPU" pct={gs.usage} value={gs.tempC != null ? temp(gs.tempC, tempUnit)[0] : '—'} unit={gs.tempC != null ? temp(gs.tempC, tempUnit)[1] : undefined}
              sub={gs.vramUsed != null ? `VRAM ${bytes(gs.vramUsed).join(NBSP)}` : gpu.info.name} series={tail(get(gpuKey(gpu.info.id, 'usage')), SPARK)} />
          ) : (
            <MetricCard kind="text" label="GPU" pct={0} value="—" sub={gpu ? gpuStateWord(gs?.state) : 'Aucun GPU'} title={gs?.detail ?? undefined} />
          )}
        </Widget>
        <Widget span={3}>
          <MetricCard label="Mémoire" pct={ramPct} value={used} unit={usedUnit} sub={`/${NBSP}${bytes(memory.total, { trim: true }).join(NBSP)}`} series={tail(series.ram, SPARK)} />
        </Widget>
        <Widget span={3}><HomeDisk snap={snap} /></Widget>

        <Widget span={8}>
          <Card title="Activité en temps réel" right={<Legend items={[{ name: 'CPU', color: 'var(--accent)' }, ...(gpu ? [{ name: 'GPU', color: 'var(--series-2)', style: 'd' as const }] : []), { name: 'Mémoire', color: 'var(--series-3)', style: 't' }]} />}>
            <LiveChart label="Activité CPU, GPU et mémoire" max={100} unit="%" times={times} spanMs={historyMs} series={[
              { name: 'CPU', color: 'var(--accent)', values: series.cpu },
              ...(gpu ? [{ name: 'GPU', color: 'var(--series-2)', style: 'd' as const, values: get(gpuKey(gpu.info.id, 'usage')) }] : []),
              { name: 'Mémoire', color: 'var(--series-3)', style: 't', values: series.ram },
            ]} />
          </Card>
        </Widget>
        <Widget span={4}><NetCard n={snap.network} rx={tail(get('netRx'), SPARK)} /></Widget>

        <Widget span={4}>
          <Card title="Top processus" right={<Sec>CPU</Sec>}>
            {procs ? (
              <div className="sw-rows">
                {topCpu(procs).map(p => <MeterRow key={p.key} label={p.name} pct={p.cpu * 5} th={NO_THRESHOLD} value={withUnit(num(p.cpu, 1), '%')} />)}
              </div>
            ) : <Empty>Lecture des processus…</Empty>}
          </Card>
        </Widget>
        <Widget span={4}>
          <Card title="Températures" right={temps.length > 0 && <LevelBadge l={tempsLevel} />}>
            {temps.length ? (
              <div className="sw-rows">
                {temps.map(s => <MeterRow key={s.id} label={s.label} pct={s.valueC} th={sensorThresholds(s.kind)} value={tempStr(s.valueC, tempUnit)} />)}
              </div>
            ) : (
              <Empty>Aucun capteur de température lisible.</Empty>
            )}
          </Card>
        </Widget>
        <div className="c4" />
      </div>
    </>
  );
}
