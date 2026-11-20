// Page Processus & apps — pas de maquette de page : reprend le composant « ProcessTable »
// (titre et aide de sa maquette) sous la rangée de cartes de métrique des écrans CPU/Disques.
import { Card, Empty, Sec, Widget } from '../components/Card';
import { MetricCard } from '../components/MetricCard';
import { ProcessTable } from '../components/ProcessTable';
import { PageHeader } from '../components/Shell';
import { be } from '../lib/api';
import { bytes, NBSP, num } from '../lib/format';
import { usePoll } from '../lib/poll';
import { tail, useLive } from '../lib/store';

const SPARK = 40;

export function ProcessesPage() {
  const { snap, series } = useLive();
  const { data, refresh } = usePoll(() => be().listProcesses(false), 2000);
  if (!snap) return <Empty>Lecture des capteurs…</Empty>;
  const m = snap.memory;
  const ramPct = m.total ? (m.used / m.total) * 100 : 0;
  const [u, uu] = bytes(m.used);
  const apps = data?.apps.length;

  const terminate = async (pids: number[]) => {
    await be().terminate(pids);
    window.setTimeout(refresh, 500);
  };

  return (
    <>
      <PageHeader title="Processus & apps" sub={`${num(snap.cpu.processes)} processus · ${num(snap.cpu.threads)} threads${apps != null ? ` · ${apps} application${apps > 1 ? 's' : ''} ouverte${apps > 1 ? 's' : ''}` : ''}`} />
      <div className="sw-grid" style={{ gridTemplateRows: '128px minmax(320px, 1fr)', minHeight: 'calc(128px + 320px + var(--space-4))' }}>
        <Widget span={3}>
          <MetricCard kind="text" label="Applications" pct={0} value={apps != null ? num(apps) : '—'} sub="ouvertes" />
        </Widget>
        <Widget span={3}>
          <MetricCard kind="text" label="Processus" pct={0} value={num(snap.cpu.processes)} sub={`${num(snap.cpu.threads)} threads`} />
        </Widget>
        <Widget span={3}>
          <MetricCard label="CPU" pct={snap.cpu.usage} value={num(snap.cpu.usage)} unit="%" sub="machine" series={tail(series.cpu, SPARK)} />
        </Widget>
        <Widget span={3}>
          <MetricCard label="Mémoire" pct={ramPct} value={u} unit={uu} sub={`/${NBSP}${bytes(m.total, { trim: true }).join(NBSP)}`} series={tail(series.ram, SPARK)} />
        </Widget>
        <Widget span={12}>
          <Card title="Processus et applications ouvertes" right={<Sec>clic sur un en-tête pour trier · « Fermer » demande confirmation</Sec>}>
            <ProcessTable list={data} memTotal={m.total} onTerminate={terminate} />
          </Card>
        </Widget>
      </div>
    </>
  );
}
