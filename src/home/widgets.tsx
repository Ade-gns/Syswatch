// Widgets de l'Accueil : les cartes de la maquette « HomeScreen » et celles du panneau
// « Ajouter un widget » de « HomeEditScreen » (CPU, GPU, Mémoire, Disque, Batterie,
// Ventilateurs, Ping & latence, Temps de démarrage), plus les cartes de liste de l'Accueil
// pour pouvoir les remettre après les avoir retirées. Taille par défaut en cellules
// (colonnes × rangées de 56 px), comme le catalogue de la maquette.
import type { ReactNode } from 'react';
import { Badge, Card, Empty, Legend, LevelBadge, MeterRow, Sec } from '../components/Card';
import { Ring, Spark } from '../components/Gauges';
import { Icon, type IconName } from '../components/Icon';
import { LiveChart } from '../components/LiveChart';
import { MetricCard } from '../components/MetricCard';
import { bytes, duration, ghz, NBSP, num, rate, secs, storage, temp, tempStr, withUnit } from '../lib/format';
import { gpuStateWord, mainGpu } from '../lib/gpu';
import { BATTERY_LOW, level, levelLow, NO_THRESHOLD, sensorThresholds, THRESHOLDS, worst } from '../lib/levels';
import { gpuKey, normalized, type Series, tail } from '../lib/store';
import type { AlertEvent, ProcessList, SensorKind, SensorReading, Snapshot, StartupInfo, SystemInfo } from '../lib/types';
import { AlertRow } from '../pages/AlertsPage';

const SPARK = 40;

export interface Ctx {
  snap: Snapshot;
  info: SystemInfo;
  series: Series;
  get: (k: string) => number[];
  peaks: Record<string, number>;
  times: number[];
  historyMs: number;
  tempUnit: 'c' | 'f';
  procs: ProcessList | null;
  alerts: AlertEvent[];
  startup: StartupInfo | null;
}

export interface WidgetDef {
  name: string;
  icon: IconName;
  w: number;
  h: number;
  minH: number;
  render: (c: Ctx) => ReactNode;
}

/* ---------- Cartes de métrique (3 × 2) ---------- */

function CpuW({ snap, series, tempUnit }: Ctx) {
  const { cpu } = snap;
  return <MetricCard label="CPU" pct={cpu.usage} value={cpu.freqMhz != null ? ghz(cpu.freqMhz) : '—'} unit={cpu.freqMhz != null ? 'GHz' : undefined}
    sub={cpu.tempC != null ? tempStr(cpu.tempC, tempUnit) : ''} series={tail(series.cpu, SPARK)} />;
}

function GpuW({ snap, info, get, tempUnit }: Ctx) {
  const g = mainGpu(info, snap);
  const s = g?.snap;
  if (!g || s?.state !== 'active' || s.usage == null) {
    return <MetricCard kind="text" label="GPU" pct={0} value="—" sub={g ? gpuStateWord(s?.state) : 'Aucun GPU'} title={s?.detail ?? undefined} />;
  }
  return <MetricCard label="GPU" pct={s.usage} value={s.tempC != null ? temp(s.tempC, tempUnit)[0] : '—'} unit={s.tempC != null ? temp(s.tempC, tempUnit)[1] : undefined}
    sub={s.vramUsed != null ? `VRAM ${bytes(s.vramUsed).join(NBSP)}` : g.info.name} series={tail(get(gpuKey(g.info.id, 'usage')), SPARK)} />;
}

function RamW({ snap, series }: Ctx) {
  const m = snap.memory;
  const [u, uu] = bytes(m.used);
  return <MetricCard label="Mémoire" pct={m.total ? (m.used / m.total) * 100 : 0} value={u} unit={uu} sub={`/${NBSP}${bytes(m.total, { trim: true }).join(NBSP)}`} series={tail(series.ram, SPARK)} />;
}

function DiskW({ snap }: Ctx) {
  const mounts = snap.disks.flatMap(d => d.mounts);
  const m = mounts.find(x => x.targets.includes('/home')) ?? mounts.find(x => x.targets.includes('/')) ?? mounts[0];
  if (!m) return <MetricCard kind="text" label="Disque" pct={0} value="—" sub="Aucun montage" />;
  const target = m.targets.includes('/home') ? '/home' : m.targets[0];
  const [u, uu] = storage(m.used);
  return <MetricCard kind="bar" label={`Disque ${target}`} pct={m.total ? (m.used / m.total) * 100 : 0} th={THRESHOLDS.disk} value={u} unit={uu} sub={`/${NBSP}${storage(m.total, { trim: true }).join(NBSP)}`} />;
}

function BatW({ snap, info }: Ctx) {
  const b = snap.batteries[0];
  if (!b) return <MetricCard kind="text" label="Batterie" pct={0} value="—" sub="Aucune batterie" title={info.capabilities.battery.detail} />;
  const sub = b.timeLeftS != null ? `${duration(b.timeLeftS)} ${b.status === 'charging' ? 'avant plein' : 'restantes'}` : b.status === 'charging' ? 'en charge' : 'secteur';
  return <MetricCard kind="bar" label="Batterie" pct={b.percent} th={BATTERY_LOW} lv={levelLow(b.percent, BATTERY_LOW)} value={num(b.percent)} unit="%" sub={sub} />;
}

function PingW({ snap, get }: Ctx) {
  const n = snap.network;
  return <MetricCard kind="text" label="Ping & latence" pct={0} value={n.pingMs != null ? num(n.pingMs, n.pingMs < 10 ? 1 : 0) : '—'} unit={n.pingMs != null ? 'ms' : undefined}
    sub={n.gateway ? `passerelle ${n.gateway}` : 'aucune passerelle'} series={normalized(tail(get('ping'), SPARK))} />;
}

function BootW({ snap, startup }: Ctx) {
  const t = startup?.boot?.totalS;
  return <MetricCard kind="text" label="Démarrage" pct={0} value={t != null ? (t >= 60 ? secs(t) : num(t, 1)) : '—'} unit={t != null && t < 60 ? 's' : undefined}
    sub={`allumé depuis ${duration(snap.uptimeS)}`} title={startup?.bootDetail ?? undefined} />;
}

/* ---------- Cartes de la maquette HomeScreen ---------- */

function ChartW({ snap, info, series, get, times, historyMs }: Ctx) {
  const g = mainGpu(info, snap);
  return (
    <Card title="Activité en temps réel" right={<Legend items={[{ name: 'CPU', color: 'var(--accent)' }, ...(g ? [{ name: 'GPU', color: 'var(--series-2)', style: 'd' as const }] : []), { name: 'Mémoire', color: 'var(--series-3)', style: 't' }]} />}>
      <LiveChart label="Activité CPU, GPU et mémoire" max={100} unit="%" times={times} spanMs={historyMs} series={[
        { name: 'CPU', color: 'var(--accent)', values: series.cpu },
        ...(g ? [{ name: 'GPU', color: 'var(--series-2)', style: 'd' as const, values: get(gpuKey(g.info.id, 'usage')) }] : []),
        { name: 'Mémoire', color: 'var(--series-3)', style: 't', values: series.ram },
      ]} />
    </Card>
  );
}

const band = (mhz: number) => (mhz >= 5925 ? '6 GHz' : mhz >= 4900 ? '5 GHz' : '2,4 GHz');

function NetW({ snap, get }: Ctx) {
  const n = snap.network;
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
      <div className="l-ok"><Spark values={tail(get('netRx'), SPARK)} min={0} h={44} /></div>
      <div className="sw-foot sw-sec">
        <span>{n.pingMs != null ? `Ping ${withUnit(num(n.pingMs), 'ms')}` : 'Ping —'}</span>
        {w && <span style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--space-1)' }}><Icon name="wifi" size={12} /> Wi‑Fi {w.freqMhz ? band(w.freqMhz) : ''}{w.signalDbm != null ? ` · −${Math.abs(w.signalDbm)}${NBSP}dBm` : ''}</span>}
      </div>
    </Card>
  );
}

/** Les 5 plus gros consommateurs de CPU : applications regroupées, autres processus seuls. */
function topCpu(l: ProcessList) {
  const loose = l.processes.filter(p => !p.app).map(p => ({ key: `p${p.pid}`, name: p.name, cpu: p.cpu }));
  return [...l.apps.map(a => ({ key: `a${a.id}`, name: a.name, cpu: a.cpu })), ...loose].sort((a, b) => b.cpu - a.cpu).slice(0, 5);
}

function ProcsW({ procs }: Ctx) {
  return (
    <Card title="Top processus" right={<Sec>CPU</Sec>}>
      {procs ? (
        <div className="sw-rows">
          {topCpu(procs).map(p => <MeterRow key={p.key} label={p.name} pct={p.cpu * 5} th={NO_THRESHOLD} value={withUnit(num(p.cpu, 1), '%')} />)}
        </div>
      ) : <Empty>Lecture des processus…</Empty>}
    </Card>
  );
}

/** Une ligne par famille, dans l'ordre de la maquette : CPU, GPU, SSD, carte mère, batterie. */
const HOME_KINDS: SensorKind[] = ['cpu', 'gpu', 'ssd', 'board', 'battery', 'ram'];
function homeSensors(all: SensorReading[]) {
  const rows: SensorReading[] = [];
  for (const k of HOME_KINDS) {
    const s = all.filter(x => x.kind === k).sort((a, b) => b.valueC - a.valueC)[0];
    if (s) rows.push(s.kind === 'gpu' || s.kind === 'ssd' || s.kind === 'cpu' ? { ...s, label: s.label.split(' · ')[0] } : s);
  }
  return rows.slice(0, 5);
}

function TempsW({ snap, tempUnit }: Ctx) {
  const temps = homeSensors(snap.sensors);
  const l = worst(temps.map(s => level(s.valueC, sensorThresholds(s.kind))));
  return (
    <Card title="Températures" right={temps.length > 0 && <LevelBadge l={l} />}>
      {temps.length ? (
        <div className="sw-rows">
          {temps.map(s => <MeterRow key={s.id} label={s.label} pct={s.valueC} th={sensorThresholds(s.kind)} value={tempStr(s.valueC, tempUnit)} />)}
        </div>
      ) : <Empty>Aucun capteur de température lisible.</Empty>}
    </Card>
  );
}

function AlertsW({ alerts }: Ctx) {
  const today = alerts.length > 0 && new Date(alerts[0].t * 1000).toDateString() === new Date().toDateString();
  return (
    <Card title="Alertes récentes" right={<Sec>{today ? 'aujourd’hui' : ''}</Sec>}>
      {alerts.length ? (
        <div className="sw-rows" style={{ justifyContent: 'flex-start', gap: 4 }}>
          {alerts.slice(0, 3).map(e => <AlertRow key={e.seq} e={e} />)}
        </div>
      ) : <Empty>Aucune alerte : tout est dans les seuils.</Empty>}
    </Card>
  );
}

function FansW({ snap, peaks }: Ctx) {
  return (
    <Card title="Ventilateurs" right={<Sec>tr/min</Sec>}>
      {snap.fans.length === 0 ? <Empty>Aucun compteur de tours exposé.</Empty> : (
        <div className="sw-fans" style={{ marginTop: 0 }}>
          {snap.fans.slice(0, 3).map(f => {
            const peak = peaks[`fan:${f.id}`];
            const pct = f.pct ?? (peak && f.rpm != null ? (f.rpm / peak) * 100 : 0);
            return (
              <div className="sw-fan" key={f.id}>
                <Ring pct={pct} size={44} stroke={5} text="" label={f.label} th={NO_THRESHOLD} />
                <div><div className="nm">{f.label}</div><div className="sw-sec">{f.pct != null ? `${num(f.pct)} % de la vitesse max.` : peak ? `${num(pct)} % du pic observé` : 'à l’arrêt'}</div></div>
                <div className="sw-val md">{f.rpm != null ? num(f.rpm) : '—'}<small>tr/min</small></div>
              </div>
            );
          })}
        </div>
      )}
    </Card>
  );
}

export const WIDGETS: Record<string, WidgetDef> = {
  cpu: { name: 'CPU', icon: 'cpu', w: 3, h: 2, minH: 2, render: c => <CpuW {...c} /> },
  gpu: { name: 'GPU', icon: 'gpu', w: 3, h: 2, minH: 2, render: c => <GpuW {...c} /> },
  ram: { name: 'Mémoire', icon: 'ram', w: 3, h: 2, minH: 2, render: c => <RamW {...c} /> },
  disk: { name: 'Disque', icon: 'disk', w: 3, h: 2, minH: 2, render: c => <DiskW {...c} /> },
  bat: { name: 'Batterie', icon: 'bat', w: 3, h: 2, minH: 2, render: c => <BatW {...c} /> },
  fan: { name: 'Ventilateurs', icon: 'fan', w: 4, h: 3, minH: 3, render: c => <FansW {...c} /> },
  ping: { name: 'Ping & latence', icon: 'net', w: 4, h: 2, minH: 2, render: c => <PingW {...c} /> },
  boot: { name: 'Temps de démarrage', icon: 'clock', w: 3, h: 2, minH: 2, render: c => <BootW {...c} /> },
  chart: { name: 'Activité en temps réel', icon: 'cpu', w: 8, h: 3, minH: 3, render: c => <ChartW {...c} /> },
  net: { name: 'Réseau', icon: 'wifi', w: 4, h: 3, minH: 3, render: c => <NetW {...c} /> },
  procs: { name: 'Top processus', icon: 'proc', w: 4, h: 4, minH: 3, render: c => <ProcsW {...c} /> },
  temps: { name: 'Températures', icon: 'temp', w: 4, h: 4, minH: 3, render: c => <TempsW {...c} /> },
  alerts: { name: 'Alertes récentes', icon: 'bell', w: 4, h: 4, minH: 3, render: c => <AlertsW {...c} /> },
};

/** Ordre du catalogue : celui de la maquette, puis les cartes de liste de l'Accueil. */
export const CATALOG = ['cpu', 'gpu', 'ram', 'disk', 'bat', 'fan', 'ping', 'boot', 'chart', 'net', 'procs', 'temps', 'alerts'];

/** Disposition par défaut = maquette HomeScreen. */
export const DEFAULT_LAYOUT = [
  { id: 'cpu', type: 'cpu', x: 0, y: 0, w: 3, h: 2 },
  { id: 'gpu', type: 'gpu', x: 3, y: 0, w: 3, h: 2 },
  { id: 'ram', type: 'ram', x: 6, y: 0, w: 3, h: 2 },
  { id: 'disk', type: 'disk', x: 9, y: 0, w: 3, h: 2 },
  { id: 'chart', type: 'chart', x: 0, y: 2, w: 8, h: 3 },
  { id: 'net', type: 'net', x: 8, y: 2, w: 4, h: 3 },
  { id: 'procs', type: 'procs', x: 0, y: 5, w: 4, h: 4 },
  { id: 'temps', type: 'temps', x: 4, y: 5, w: 4, h: 4 },
  { id: 'alerts', type: 'alerts', x: 8, y: 5, w: 4, h: 4 },
];
