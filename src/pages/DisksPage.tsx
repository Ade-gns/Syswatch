// Page Disques — maquette « DisksScreen » : sélecteur segmenté du disque ; santé SMART,
// température, lecture, écriture ; courbe lecture/écriture + anneau d'espace (seuils 80/90 %,
// badge « Presque plein ») ; espace par dossier (barres d'accent, sans seuil) + table SMART
// (un attribut hors norme porte un badge, jamais la couleur seule).
import { type CSSProperties, useState } from 'react';
import { Badge, Card, Empty, Legend, Sec, Widget } from '../components/Card';
import { Segmented } from '../components/Controls';
import { Bar, Ring } from '../components/Gauges';
import { LiveChart } from '../components/LiveChart';
import { MetricCard } from '../components/MetricCard';
import { PageHeader } from '../components/Shell';
import { be } from '../lib/api';
import { NBSP, num, rate, rateStr, storage, storageStr, temp, tempStr, withUnit } from '../lib/format';
import { level, NO_THRESHOLD, THRESHOLDS, type Level, type Thresholds } from '../lib/levels';
import { usePoll } from '../lib/poll';
import { useSettings } from '../lib/settings';
import { diskKey, normalized, tail, useLive } from '../lib/store';
import type { DiskKind, DiskSnapshot, SmartStatus } from '../lib/types';

const SPARK = 40;
const MIB = 1024 * 1024;
const KIND: Record<DiskKind, string> = { nvme: 'NVMe', ssd: 'SSD', hdd: 'HDD', usb: 'USB' };
const SPACE_WORDS: Record<Level, string> = { ok: 'Normal', warn: 'Attention', crit: 'Presque plein' };
const HEALTH_WORDS: Record<SmartStatus, string> = { ok: 'Bon', warn: 'Attention', crit: 'Critique' };
const ATTR_WORDS: Record<SmartStatus, string> = { ok: 'OK', warn: 'Attention', crit: 'Critique' };
const LEVEL_COLOR: Record<Level, string> = { ok: 'var(--accent)', warn: 'var(--warn)', crit: 'var(--crit)' };
/** Dossiers affichés avant « Autres » (6 lignes comme la maquette). */
const FOLDERS = 5;

const tempTh = (d: DiskSnapshot): Thresholds => (d.kind === 'nvme' ? THRESHOLDS.nvmeTemp : THRESHOLDS.tempDefault);
const segLabel = (d: DiskSnapshot) => (d.kind === 'nvme' ? d.id : `${d.id} · ${KIND[d.kind]}`);
const ago = (s: number) => {
  const d = Math.max(0, Math.round(Date.now() / 1000 - s));
  return d < 60 ? `il y a ${d}${NBSP}s` : d < 3600 ? `il y a ${Math.round(d / 60)}${NBSP}min` : `il y a ${Math.round(d / 3600)}${NBSP}h`;
};

export function DisksPage() {
  const { snap, times, get, peaks, historyMs } = useLive();
  const { tempUnit } = useSettings();
  const [sel, setSel] = useState<string | null>(null);
  const disks = snap?.disks ?? [];
  const d = disks.find(x => x.id === sel) ?? disks.find(x => x.mounts.length > 0) ?? disks[0];
  const id = d?.id ?? '';
  const smart = usePoll(() => (id ? be().diskSmart(id) : Promise.resolve(null)), 30_000, id).data;
  const [scanDone, setScanDone] = useState<Record<string, boolean>>({});
  const scan = usePoll(async () => {
    if (!id) return null;
    const s = await be().scanFolders(id, false);
    if (!s.running) setScanDone(m => (m[id] ? m : { ...m, [id]: true }));
    return s;
  }, scanDone[id] ? null : 1000, id).data;

  if (!snap) return <Empty>Lecture des capteurs…</Empty>;
  if (!d) {
    return (
      <>
        <PageHeader title="Disques" sub="Aucun disque détecté" />
        <Card title="Disques" className="flex-1"><Empty>Aucun périphérique de stockage trouvé dans /sys/block.</Empty></Card>
      </>
    );
  }

  const main = d.mounts[0];
  const sub = [d.id, d.model, storage(d.size, { trim: true }).join(NBSP), main && `monté sur ${main.targets.slice(0, 2).join(', ')}`].filter(Boolean).join(' · ');
  const sm = smart && smart.available ? smart : null;

  // Espace.
  const usedPct = main && main.total ? (main.used / main.total) * 100 : 0;
  const spaceLevel = level(usedPct, THRESHOLDS.disk);

  // Espace par dossier : 5 plus gros + « Autres » (reste de l'espace utilisé).
  const entries = scan && scan.disk === id ? scan.entries : [];
  const top = entries.slice(0, FOLDERS);
  const others = main ? Math.max(0, main.used - top.reduce((a, e) => a + e.bytes, 0)) : 0;
  const folderRows = scan && !scan.running && main ? [...top, { name: 'Autres', bytes: others }] : top;

  const rPeak = peaks[diskKey(id, 'read')];
  const wPeak = peaks[diskKey(id, 'write')];
  const tPeak = peaks[diskKey(id, 'temp')];
  const [rv, ru] = rate(d.readBps);
  const [wv, wu] = rate(d.writeBps);

  return (
    <>
      <PageHeader title="Disques" sub={sub}
        actions={disks.length > 1 && <Segmented label="Choix du disque" value={id} onChange={setSel} items={disks.map(x => ({ value: x.id, label: segLabel(x) }))} />} />
      <div className="sw-grid" style={{ gridTemplateRows: '128px 220px minmax(240px, 1fr)', minHeight: 'calc(128px + 220px + 240px + 2 * var(--space-4))' }}>
        <Widget span={3}>
          <div className={`sw-card sw-metric bar l-${sm?.health ?? 'ok'}`} title={smart?.detail ?? undefined}>
            <div className="t" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
              <span className="sw-label">Santé SMART</span>
              {sm?.health && <Badge s={sm.health}>{HEALTH_WORDS[sm.health]}</Badge>}
            </div>
            <div className="sw-val">{sm?.remainingPct != null ? <>{num(sm.remainingPct)}<small>% restant</small></> : '—'}</div>
            <span className="sw-sec">
              {sm ? [sm.wearPct != null && `Usure ${withUnit(num(sm.wearPct), '%')}`, sm.powerOnHours != null && withUnit(num(sm.powerOnHours), 'h')].filter(Boolean).join(' · ')
                : smart ? 'Non disponible' : 'Lecture…'}
            </span>
          </div>
        </Widget>
        <Widget span={3}>
          {d.tempC != null ? (
            <MetricCard kind="bar" label="Température" pct={d.tempC} th={tempTh(d)} value={temp(d.tempC, tempUnit)[0]} unit={temp(d.tempC, tempUnit)[1]}
              sub={tPeak != null ? `pic ${tempStr(tPeak, tempUnit)}` : ''} />
          ) : (
            <MetricCard kind="text" label="Température" pct={0} value="—" sub="Capteur non exposé" />
          )}
        </Widget>
        <Widget span={3}>
          <MetricCard kind="text" label="Lecture" pct={0} value={rv} unit={ru} sub={rPeak ? `pic ${rateStr(rPeak)}` : ''} series={normalized(tail(get(diskKey(id, 'read')), SPARK))} />
        </Widget>
        <Widget span={3}>
          <MetricCard kind="text" label="Écriture" pct={0} value={wv} unit={wu} sub={wPeak ? `pic ${rateStr(wPeak)}` : ''} series={normalized(tail(get(diskKey(id, 'write')), SPARK))} />
        </Widget>

        <Widget span={8}>
          <Card title="Lecture / écriture" right={<Legend items={[{ name: 'Lecture', color: 'var(--accent)' }, { name: 'Écriture', color: 'var(--series-2)', style: 'd' }]} />}>
            <LiveChart label="Débit de lecture et d’écriture" unit="Mo/s" times={times} spanMs={historyMs} series={[
              { name: 'Lecture', color: 'var(--accent)', values: get(diskKey(id, 'read')).map(v => v / MIB), dec: 1 },
              { name: 'Écriture', color: 'var(--series-2)', values: get(diskKey(id, 'write')).map(v => v / MIB), dec: 1 },
            ]} />
          </Card>
        </Widget>
        <Widget span={4}>
          <Card title="Espace disque" right={main && <Badge s={spaceLevel}>{SPACE_WORDS[spaceLevel]}</Badge>}>
            {main ? (
              <div className="sw-donut">
                <Ring pct={usedPct} size={128} stroke={14} th={THRESHOLDS.disk} label="Espace utilisé" fs={26} />
                <div className="sw-lg2">
                  <div><span><i style={{ '--c': LEVEL_COLOR[spaceLevel] } as CSSProperties} />Utilisé</span><span className="sw-mono">{storageStr(main.used)}</span></div>
                  <div><span><i style={{ '--c': 'var(--border)', boxShadow: 'inset 0 0 0 1px var(--control-border)' } as CSSProperties} />Libre</span><span className="sw-mono">{storageStr(main.available, { unit: storage(main.used)[1] === 'To' ? 'To' : undefined })}</span></div>
                  <div className="sw-sec">Seuils 80 / 90 %</div>
                </div>
              </div>
            ) : <Empty>Aucune partition montée.</Empty>}
          </Card>
        </Widget>

        <Widget span={6}>
          <Card title="Espace par dossier" right={<Sec>{scan?.running ? `analyse de ${scan.root}… ${num(scan.files)} fichiers` : main ? `${scan?.root ?? ''} · sur ${storage(main.total, { trim: true }).join(NBSP)}` : ''}</Sec>}>
            {!main ? <Empty>Aucune partition montée.</Empty> : folderRows.length === 0 ? <Empty>Analyse en cours…</Empty> : (
              <div className="sw-rows" style={{ justifyContent: 'flex-start', gap: 2 }}>
                {folderRows.map(f => (
                  <div className="sw-hb" key={f.name}>
                    <span className="nm" title={f.name}>{f.name}</span>
                    <span className="l-ok"><Bar pct={(f.bytes / main.total) * 100} th={NO_THRESHOLD} ticks={false} h={8} /></span>
                    <span className="sw-mono">{storageStr(f.bytes)}</span>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </Widget>
        <Widget span={6}>
          <Card title={`SMART${sm?.protocol ? ` · ${sm.protocol}` : ''}`} right={<Sec>{sm?.updatedS ? `mis à jour ${ago(sm.updatedS)}` : ''}</Sec>}>
            {!smart ? <Empty>Lecture SMART…</Empty> : !sm ? <Empty>{smart.detail}</Empty> : (
              <div className="sw-pscroll">
                <table className="sw-table dense">
                  <thead><tr><th>ID</th><th>Attribut</th><th className="n">Valeur</th><th className="n">Seuil</th><th>État</th></tr></thead>
                  <tbody>
                    {sm.attributes.map(a => (
                      <tr key={a.id + a.name}>
                        <td className="n" style={{ textAlign: 'left', color: 'var(--text-muted)' }}>{a.id}</td>
                        <td>{a.name}</td>
                        <td className="n">{a.value}</td>
                        <td className="n">{a.threshold}</td>
                        <td><Badge s={a.status}>{ATTR_WORDS[a.status]}</Badge></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </Widget>
      </div>
    </>
  );
}
