// Page Réseau — pas de maquette de page : composée avec la grille de « CpuScreen », le
// graphique « Réseau · échelle automatique » de la maquette LiveChart, la carte réseau de
// l'Accueil et le tableau dense de « DisksScreen ». Les adresses distantes ne sont pas
// résolues en noms : ce serait une requête DNS, donc des données envoyées sur le réseau.
import { useMemo } from 'react';
import { Badge, Card, Empty, KeyValue, Legend, Sec, Widget } from '../components/Card';
import { LiveChart } from '../components/LiveChart';
import { MetricCard } from '../components/MetricCard';
import { PageHeader } from '../components/Shell';
import { be } from '../lib/api';
import { bytesStr, num, rate, rateStr, withUnit } from '../lib/format';
import { usePoll } from '../lib/poll';
import { normalized, tail, useLive } from '../lib/store';
import type { IfaceKind, ProcessList } from '../lib/types';

const SPARK = 40;
const MIB = 1024 * 1024;
const KIND: Record<IfaceKind, string> = { wifi: 'Wi-Fi', ethernet: 'Ethernet', other: 'Réseau', virtual: 'Virtuelle', loopback: 'Boucle locale' };
const band = (mhz: number) => (mhz >= 5925 ? '6 GHz' : mhz >= 4900 ? '5 GHz' : '2,4 GHz');

interface AppConn { name: string; established: number; listening: number; remotes: string[]; rx: number | null; tx: number | null }

/** Connexions regroupées par application (ou par processus hors application). */
function byApp(list: ProcessList): AppConn[] {
  const procs = new Map(list.processes.map(p => [p.pid, p]));
  const apps = new Map(list.apps.map(a => [a.id, a]));
  const groups = new Map<string, AppConn & { pids: Set<number> }>();
  for (const c of list.connections) {
    const p = c.pid != null ? procs.get(c.pid) : undefined;
    const app = p?.app ? apps.get(p.app) : undefined;
    const key = app ? `a:${app.id}` : p ? `p:${p.name}` : 'x';
    let g = groups.get(key);
    if (!g) {
      // Débit : celui de l'application entière, sinon additionné par processus ci-dessous.
      g = { name: app?.name ?? p?.name ?? 'Système ou autre utilisateur', established: 0, listening: 0, remotes: [], pids: new Set(), rx: app ? app.netRx : null, tx: app ? app.netTx : null };
      groups.set(key, g);
    }
    if (!app && p && !g.pids.has(p.pid) && p.netRx != null) {
      g.rx = (g.rx ?? 0) + p.netRx;
      g.tx = (g.tx ?? 0) + (p.netTx ?? 0);
    }
    if (p) g.pids.add(p.pid);
    if (c.listening) g.listening++;
    else {
      g.established++;
      if (!g.remotes.includes(c.remote)) g.remotes.push(c.remote);
    }
  }
  return [...groups.values()].sort((a, b) => (b.rx ?? 0) + (b.tx ?? 0) - ((a.rx ?? 0) + (a.tx ?? 0)) || b.established - a.established);
}

export function NetworkPage() {
  const { snap, times, get, historyMs } = useLive();
  const { data } = usePoll(() => be().listProcesses(true), 3000);
  const conns = useMemo(() => (data ? byApp(data) : null), [data]);
  if (!snap) return <Empty>Lecture des capteurs…</Empty>;
  const n = snap.network;
  const main = n.interfaces.find(i => i.name === n.defaultIface);
  const w = n.wifi;
  const ip = main?.ipv4[0]?.split('/')[0];
  const sub = [main ? (main.kind === 'wifi' && w?.ssid ? `Wi-Fi « ${w.ssid} »` : `${KIND[main.kind]} ${main.name}`) : 'Aucune route par défaut', ip, n.gateway && `passerelle ${n.gateway}`].filter(Boolean).join(' · ');
  const [rx, rxu] = rate(n.rxBps);
  const [tx, txu] = rate(n.txBps);
  const shown = n.interfaces.filter(i => i.kind !== 'loopback' && (i.up || i.kind !== 'virtual'));
  const mb = (v: number[]) => v.map(x => x / MIB);

  return (
    <>
      <PageHeader title="Réseau" sub={sub} actions={<Badge s={n.connected ? 'ok' : 'crit'}>{n.connected ? 'Connecté' : 'Déconnecté'}</Badge>} />
      <div className="sw-grid" style={{ gridTemplateRows: '128px 236px minmax(220px, 1fr)', minHeight: 'calc(128px + 236px + 220px + 2 * var(--space-4))' }}>
        <Widget span={3}>
          <MetricCard kind="text" label="Réception" pct={0} value={rx} unit={rxu} sub={main ? `total ${bytesStr(main.rxTotal)}` : ''} series={normalized(tail(get('netRx'), SPARK))} />
        </Widget>
        <Widget span={3}>
          <MetricCard kind="text" label="Émission" pct={0} value={tx} unit={txu} sub={main ? `total ${bytesStr(main.txTotal)}` : ''} series={normalized(tail(get('netTx'), SPARK))} />
        </Widget>
        <Widget span={3}>
          <MetricCard kind="text" label="Latence" pct={0} value={n.pingMs != null ? num(n.pingMs, n.pingMs < 10 ? 1 : 0) : '—'} unit={n.pingMs != null ? 'ms' : undefined}
            sub={n.pingTarget ? (n.pingMs != null ? 'passerelle locale' : 'sans réponse') : 'aucune passerelle'} series={normalized(tail(get('ping'), SPARK))}
            title="Ping ICMP vers la passerelle locale toutes les 5 s ; aucune requête vers Internet" />
        </Widget>
        <Widget span={3}>
          {w ? (
            <MetricCard kind="text" label="Wi-Fi" pct={0} value={w.signalDbm != null ? `−${Math.abs(w.signalDbm)}` : '—'} unit={w.signalDbm != null ? 'dBm' : undefined}
              sub={[w.freqMhz && band(w.freqMhz), w.rxMbps && withUnit(num(w.rxMbps), 'Mb/s')].filter(Boolean).join(' · ')} />
          ) : main?.kind === 'ethernet' ? (
            <MetricCard kind="text" label="Ethernet" pct={0} value={main.speedMbps ? num(main.speedMbps) : '—'} unit={main.speedMbps ? 'Mb/s' : undefined} sub="vitesse du lien" />
          ) : (
            <MetricCard kind="text" label="Wi-Fi" pct={0} value="—" sub="Aucune carte Wi-Fi active" />
          )}
        </Widget>

        <Widget span={8}>
          <Card title="Débit réseau" right={<Legend items={[{ name: 'Réception', color: 'var(--accent)' }, { name: 'Émission', color: 'var(--series-2)', style: 'd' }]} />}>
            <LiveChart label="Débit réseau en réception et en émission" unit="Mo/s" times={times} spanMs={historyMs} series={[
              { name: 'Réception', color: 'var(--accent)', values: mb(get('netRx')), dec: 2 },
              { name: 'Émission', color: 'var(--series-2)', values: mb(get('netTx')), dec: 2 },
            ]} />
          </Card>
        </Widget>
        <Widget span={4}>
          <Card title="Interfaces" right={<Sec>↓ réception · ↑ émission</Sec>}>
            <div className="sw-rows scroll">
              <KeyValue rows={shown.map(i => [`${i.name} · ${KIND[i.kind]}`, i.up ? `↓ ${rateStr(i.rxBps)} · ↑ ${rateStr(i.txBps)}` : 'déconnectée'] as [string, string])} />
            </div>
          </Card>
        </Widget>

        <Widget span={8}>
          <Card title="Connexions par application" right={<Sec>TCP et UDP · adresses non résolues</Sec>}>
            {conns == null ? <Empty>Lecture des connexions…</Empty> : conns.length === 0 ? <Empty>Aucune connexion ouverte.</Empty> : (
              <div className="sw-pscroll">
                <table className="sw-table dense">
                  <thead>
                    <tr><th>Application</th><th className="n">Connexions</th><th className="n">En écoute</th><th>Hôtes distants</th><th className="n">Réception</th><th className="n">Émission</th></tr>
                  </thead>
                  <tbody>
                    {conns.map(c => (
                      <tr key={c.name}>
                        <td>{c.name}</td>
                        <td className="n">{num(c.established)}</td>
                        <td className="n">{c.listening ? num(c.listening) : '—'}</td>
                        <td className="sw-mono" title={c.remotes.join('\n')}>{c.remotes.slice(0, 2).join(', ')}{c.remotes.length > 2 ? ` +${c.remotes.length - 2}` : ''}{!c.remotes.length && '—'}</td>
                        <td className="n">{c.rx == null ? '—' : rateStr(c.rx)}</td>
                        <td className="n">{c.tx == null ? '—' : rateStr(c.tx)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </Widget>
        <Widget span={4}>
          <Card title="Adresses">
            <KeyValue rows={[
              ['IPv4', main?.ipv4.join(', ') || '—'],
              ['IPv6', main?.ipv6[0]?.split('/')[0] ?? '—'],
              ['Passerelle', n.gateway ?? '—'],
              ['DNS', n.dns.slice(0, 2).join(', ') || '—'],
              ['Adresse MAC', main?.mac ?? '—'],
              ...(w ? [['Réseau Wi-Fi', w.ssid ?? '—'] as [string, string], ['Fréquence', w.freqMhz ? withUnit(num(w.freqMhz), 'MHz') : '—'] as [string, string]] : []),
            ]} />
          </Card>
        </Widget>
      </div>
    </>
  );
}
