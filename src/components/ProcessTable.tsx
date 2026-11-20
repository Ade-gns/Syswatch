// Tableau de processus — composant « ProcessTable » du design : recherche, bascule
// « Applications ouvertes » / « Tous les processus », tri au clic sur un en-tête (la flèche
// donne le sens), mini-barres CPU et RAM selon les seuils, et « Fermer » qui devient
// « Confirmer » pendant 3 secondes avant d'envoyer le signal. Clic sur une ligne : détail.
import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { errText } from '../lib/api';
import { bytesStr, num, rateStr, since, withUnit } from '../lib/format';
import { level } from '../lib/levels';
import type { AppInfo, ProcInfo, ProcessList } from '../lib/types';
import { Segmented } from './Controls';
import { Bar } from './Gauges';
import { Icon } from './Icon';

type Scope = 'app' | 'all';
type Key = 'name' | 'cpu' | 'mem' | 'disk' | 'net';

interface Row {
  key: string;
  name: string;
  pid: number;
  pids: number[];
  cpu: number;
  mem: number;
  disk: number | null;
  net: number | null;
  proc?: ProcInfo;
  app?: AppInfo;
}

const COLS: [Key, string, boolean][] = [['name', 'Nom', false], ['cpu', 'CPU', true], ['mem', 'RAM', true], ['disk', 'Disque', true], ['net', 'Réseau', true]];
/** Échelle des mini-barres CPU du design : 25 % de la machine remplit la barre. */
const CPU_SCALE = 4;
const sumOrNull = (a: number | null, b: number | null) => (a == null && b == null ? null : (a ?? 0) + (b ?? 0));

export function ProcessTable({ list, memTotal, onTerminate, initialScope = 'app' }: {
  list: ProcessList | null;
  memTotal: number;
  onTerminate: (pids: number[]) => Promise<void>;
  initialScope?: Scope;
}) {
  const [scope, setScope] = useState<Scope>(initialScope);
  const [q, setQ] = useState('');
  const [sort, setSort] = useState<{ key: Key; dir: 1 | -1 }>({ key: 'cpu', dir: -1 });
  const [armed, setArmed] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const timer = useRef(0);
  useEffect(() => () => clearTimeout(timer.current), []);

  const rows = useMemo<Row[]>(() => {
    if (!list) return [];
    const base: Row[] = scope === 'app'
      ? list.apps.map(a => ({ key: `a:${a.id}`, name: a.name, pid: a.pid, pids: a.pids, cpu: a.cpu, mem: a.mem, disk: a.diskRead + a.diskWrite, net: a.netRx + a.netTx, app: a }))
      : list.processes.map(p => ({ key: `p:${p.pid}`, name: p.name, pid: p.pid, pids: [p.pid], cpu: p.cpu, mem: p.mem, disk: sumOrNull(p.diskRead, p.diskWrite), net: sumOrNull(p.netRx, p.netTx), proc: p }));
    const needle = q.trim().toLowerCase();
    const filtered = needle ? base.filter(r => r.name.toLowerCase().includes(needle) || String(r.pid).startsWith(needle) || r.proc?.cmd.toLowerCase().includes(needle)) : base;
    const { key, dir } = sort;
    return filtered.sort((a, b) => {
      const x = a[key] ?? -1, y = b[key] ?? -1;
      return (typeof x === 'string' ? x.localeCompare(y as string, 'fr') : (x as number) - (y as number)) * dir;
    });
  }, [list, scope, q, sort]);

  const byPid = useMemo(() => new Map(list?.processes.map(p => [p.pid, p]) ?? []), [list]);

  const onSort = (k: Key) => setSort(s => (s.key === k ? { key: k, dir: (s.dir * -1) as 1 | -1 } : { key: k, dir: k === 'name' ? 1 : -1 }));

  const onClose = async (r: Row) => {
    clearTimeout(timer.current);
    if (armed !== r.key) {
      setArmed(r.key);
      timer.current = window.setTimeout(() => setArmed(null), 3000);
      return;
    }
    setArmed(null);
    try {
      await onTerminate(r.pids);
      setError(null);
    } catch (e) {
      setError(errText(e));
      timer.current = window.setTimeout(() => setError(null), 6000);
    }
  };

  return (
    <div className="sw-ptable">
      <div className="sw-ptool">
        <div className="sw-search">
          <Icon name="search" size={15} />
          <input className="sw-input" type="search" placeholder="Rechercher un processus" aria-label="Rechercher un processus" value={q} onChange={e => setQ(e.target.value)} />
        </div>
        {error && <span className="sw-perr" role="alert"><Icon name="warn" size={14} />{error}</span>}
        <Segmented label="Portée" value={scope} onChange={v => { setScope(v); setOpen(null); }}
          items={[{ value: 'app', label: 'Applications ouvertes' }, { value: 'all', label: 'Tous les processus' }]} />
      </div>
      <div className="sw-pscroll">
        <table className="sw-table">
          <thead>
            <tr>
              {COLS.map(([k, label, n]) => (
                <th key={k} className={n ? 'n' : ''} aria-sort={sort.key === k ? (sort.dir < 0 ? 'descending' : 'ascending') : undefined}>
                  <button type="button" onClick={() => onSort(k)}>{label}<Icon name="down" size={12} /></button>
                </th>
              ))}
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.map(r => {
              const cpuPct = Math.min(100, r.cpu * CPU_SCALE);
              const memPct = memTotal ? Math.min(100, (r.mem / memTotal) * 100) : 0;
              const on = armed === r.key;
              const expanded = open === r.key;
              return (
                <Fragment key={r.key}>
                  <tr className={expanded ? 'is-open' : ''} onClick={() => setOpen(expanded ? null : r.key)}>
                    <td>
                      <span className="sw-pn"><i>{r.name.charAt(0)}</i>{r.name}<span className="p">{r.app ? `${r.pids.length} proc.` : r.pid}</span></span>
                    </td>
                    <td className="n"><span className="sw-cell"><span className={`l-${level(cpuPct)}`}><Bar pct={cpuPct} ticks={false} h={5} /></span>{withUnit(num(r.cpu, 1), '%')}</span></td>
                    <td className="n"><span className="sw-cell"><span className={`l-${level(memPct)}`}><Bar pct={memPct} ticks={false} h={5} /></span>{bytesStr(r.mem)}</span></td>
                    <td className="n">{r.disk == null ? '—' : rateStr(r.disk)}</td>
                    <td className="n">{r.net == null ? '—' : rateStr(r.net)}</td>
                    <td className="act">
                      <button type="button" className={`sw-btn sm dng${on ? ' on' : ''}`} aria-label={`Fermer ${r.name}`}
                        onClick={e => { e.stopPropagation(); onClose(r); }}>
                        <Icon name="x" size={12} />{on ? 'Confirmer' : 'Fermer'}
                      </button>
                    </td>
                  </tr>
                  {expanded && (
                    <tr className="sw-pdet">
                      <td colSpan={6}><Detail row={r} leader={byPid.get(r.pid)} /></td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
        {list && rows.length === 0 && <div className="sw-empty">{q ? 'Aucun processus ne correspond à la recherche.' : scope === 'app' ? 'Aucune application ouverte détectée.' : 'Aucun processus.'}</div>}
        {!list && <div className="sw-empty">Lecture des processus…</div>}
      </div>
    </div>
  );
}

function Detail({ row, leader }: { row: Row; leader?: ProcInfo }) {
  const p = row.proc ?? leader;
  const app = row.app;
  const items: [string, string][] = [
    ['PID', app ? `${row.pid} (principal) · ${app.pids.length} processus` : String(row.pid)],
    ['Utilisateur', p?.user ?? '—'],
    ['Démarré', p ? since(p.startS) : '—'],
    ['Threads', p ? num(p.threads) : '—'],
    ['Disque', app ? `lecture ${rateStr(app.diskRead)} · écriture ${rateStr(app.diskWrite)}` : p?.diskRead != null ? `lecture ${rateStr(p.diskRead)} · écriture ${rateStr(p.diskWrite ?? 0)}` : 'Non lisible (autre utilisateur)'],
    ['Réseau (TCP)', app ? `↓ ${rateStr(app.netRx)} · ↑ ${rateStr(app.netTx)}` : p?.netRx != null ? `↓ ${rateStr(p.netRx)} · ↑ ${rateStr(p.netTx ?? 0)}` : 'Non lisible (autre utilisateur)'],
  ];
  return (
    <div className="sw-pdet-in">
      <div className="kv">{items.map(([k, v]) => <div key={k}><span>{k}</span><span>{v}</span></div>)}</div>
      {p?.cmd && <code title={p.cmd}>{p.cmd}</code>}
    </div>
  );
}
