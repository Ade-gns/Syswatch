// Page Mémoire — pas de maquette dédiée : composée avec la grille et les pièces de la maquette
// « CpuScreen » (4 cartes de métrique, courbe + carte de liste, cartes de liste et fiche).
// Le classement des processus par RAM arrive avec la page Processus (étape 3).
import { Card, Empty, KeyValue, Legend, LevelBadge, MeterRow, Sec, Widget } from '../components/Card';
import { LiveChart } from '../components/LiveChart';
import { MetricCard } from '../components/MetricCard';
import { PageHeader } from '../components/Shell';
import { bytes, bytesStr, NBSP, num, tempStr, withUnit } from '../lib/format';
import { level, NO_THRESHOLD, sensorThresholds, THRESHOLDS, worst } from '../lib/levels';
import { useSettings } from '../lib/settings';
import { tail, useLive } from '../lib/store';

const SPARK = 40;
const SWAP_KIND = { zram: 'zram (compressée en RAM)', partition: 'Partition', fichier: 'Fichier' } as const;

export function MemoryPage() {
  const { snap, times, get, historyMs } = useLive();
  const { tempUnit } = useSettings();
  if (!snap) return <Empty>Lecture des capteurs…</Empty>;
  const m = snap.memory;
  const pct = (v: number) => (m.total ? (v / m.total) * 100 : 0);
  const usedPct = pct(m.used);
  const swapPct = m.swapTotal ? (m.swapUsed / m.swapTotal) * 100 : 0;
  const total = bytes(m.total, { trim: true }).join(NBSP);
  const ramSensors = snap.sensors.filter(s => s.kind === 'ram');
  const [u, uu] = bytes(m.used);
  const [a, au] = bytes(m.available);
  const [c, cu] = bytes(m.cached);
  const [sw, swu] = bytes(m.swapUsed);
  // « Applications » : mémoire réellement utilisée hors cache et tampons.
  const apps = Math.max(0, m.total - m.free - m.cached - m.buffers);

  return (
    <>
      <PageHeader title="Mémoire" sub={`${total} de mémoire vive${m.swapTotal ? ` · swap ${bytes(m.swapTotal, { trim: true }).join(NBSP)}${m.swapKind ? ` (${m.swapKind})` : ''}` : ' · pas de swap'}`}
        actions={<LevelBadge l={level(usedPct, THRESHOLDS.load)} />} />
      <div className="sw-grid" style={{ gridTemplateRows: '128px 236px minmax(200px, 1fr)', minHeight: 'calc(128px + 236px + 200px + 2 * var(--space-4))' }}>
        <Widget span={3}>
          <MetricCard label="Utilisée" pct={usedPct} value={u} unit={uu} sub={`/${NBSP}${total}`} series={tail(get('ram'), SPARK)} />
        </Widget>
        <Widget span={3}>
          <MetricCard kind="text" label="Disponible" pct={0} value={a} unit={au} sub={`${num(pct(m.available))}${NBSP}%`} />
        </Widget>
        <Widget span={3}>
          <MetricCard kind="text" label="Cache" pct={0} value={c} unit={cu} sub="récupérable" />
        </Widget>
        <Widget span={3}>
          {m.swapTotal ? (
            <MetricCard kind="bar" label="Swap" pct={swapPct} value={sw} unit={swu} sub={`/${NBSP}${bytes(m.swapTotal, { trim: true }).join(NBSP)}`} />
          ) : (
            <MetricCard kind="text" label="Swap" pct={0} value="—" sub="Aucun swap actif" />
          )}
        </Widget>

        <Widget span={8}>
          <Card title="Utilisation de la mémoire" right={<Legend items={[{ name: 'Mémoire vive', color: 'var(--accent)' }, { name: 'Swap', color: 'var(--series-2)', style: 'd' }]} />}>
            <LiveChart label="Utilisation de la mémoire vive et du swap" max={100} unit="%" times={times} spanMs={historyMs} series={[
              { name: 'Mémoire vive', color: 'var(--accent)', values: get('ram') },
              { name: 'Swap', color: 'var(--series-2)', values: get('swap') },
            ]} />
          </Card>
        </Widget>
        <Widget span={4}>
          <Card title="Répartition" right={<Sec>sur {total}</Sec>}>
            <div className="sw-rows">
              <MeterRow label="Applications" pct={pct(apps)} th={NO_THRESHOLD} value={bytesStr(apps)} />
              <MeterRow label="Cache" pct={pct(m.cached)} th={NO_THRESHOLD} value={bytesStr(m.cached)} />
              <MeterRow label="Tampons" pct={pct(m.buffers)} th={NO_THRESHOLD} value={bytesStr(m.buffers)} />
              <MeterRow label="Partagée" pct={pct(m.shared)} th={NO_THRESHOLD} value={bytesStr(m.shared)} />
              <MeterRow label="Libre" pct={pct(m.free)} th={NO_THRESHOLD} value={bytesStr(m.free)} />
            </div>
          </Card>
        </Widget>

        <Widget span={4}>
          <Card title="Températures" right={ramSensors.length > 0 && <LevelBadge l={worst(ramSensors.map(s => level(s.valueC, sensorThresholds('ram'))))} />}>
            {ramSensors.length ? (
              <div className="sw-rows" style={{ justifyContent: 'flex-start' }}>
                {ramSensors.map((s, i) => (
                  <MeterRow key={s.id} label={ramSensors.length > 1 ? `Barrette ${i + 1}` : 'Barrette'} pct={s.valueC} th={sensorThresholds('ram')} value={tempStr(s.valueC, tempUnit)} />
                ))}
              </div>
            ) : (
              <Empty>Aucun capteur de température sur les barrettes.</Empty>
            )}
          </Card>
        </Widget>
        <Widget span={4}>
          <Card title="Swap">
            {m.swapTotal ? (
              <KeyValue rows={[
                ['Type', m.swapKind ? SWAP_KIND[m.swapKind] : '—'],
                ['Taille', bytesStr(m.swapTotal)],
                ['Utilisé', `${bytesStr(m.swapUsed)} · ${withUnit(num(swapPct), '%')}`],
                ['En cache', bytesStr(m.swapCached)],
              ]} />
            ) : (
              <Empty>Aucun périphérique de swap actif.</Empty>
            )}
          </Card>
        </Widget>
        <Widget span={4}>
          <Card title="Informations">
            <KeyValue rows={[
              ['Totale', bytesStr(m.total)],
              ['Disponible', bytesStr(m.available)],
              ['En attente d’écriture', bytesStr(m.dirty)],
              ['SysWatch lui-même', snap.selfMemBytes != null ? bytesStr(snap.selfMemBytes) : '—'],
            ]} />
          </Card>
        </Widget>
      </div>
    </>
  );
}
