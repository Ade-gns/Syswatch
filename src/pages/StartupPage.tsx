// Page Démarrage — pas de maquette de page : cartes de métrique des écrans CPU/Disques,
// lignes de réglage (libellé + interrupteur) de « SettingsScreen », barres de « CpuScreen ».
// Désactiver un programme écrit une surcharge dans ~/.config/autostart ; les composants
// du bureau (Plasma, agent polkit…) sont affichés sans interrupteur.
import { useState } from 'react';
import { Card, Empty, MeterRow, Sec, Widget } from '../components/Card';
import { SettingRow, Switch } from '../components/Controls';
import { Icon } from '../components/Icon';
import { MetricCard } from '../components/MetricCard';
import { PageHeader } from '../components/Shell';
import { be, errText } from '../lib/api';
import { duration, num, secs } from '../lib/format';
import { NO_THRESHOLD } from '../lib/levels';
import { usePoll } from '../lib/poll';
import { useLive } from '../lib/store';
import type { AutostartEntry } from '../lib/types';

const sum = (...v: (number | null)[]) => (v.every(x => x == null) ? null : v.reduce<number>((a, x) => a + (x ?? 0), 0));
const split = (s: number | null): [string, string | undefined] => (s == null ? ['—', undefined] : s >= 60 ? [secs(s), undefined] : [num(s, 1), 's']);

export function StartupPage() {
  const { snap } = useLive();
  const { data, error, refresh } = usePoll(() => be().getStartup(), null);
  const [busy, setBusy] = useState<string | null>(null);
  const [fail, setFail] = useState<string | null>(null);

  const toggle = async (e: AutostartEntry, on: boolean) => {
    setBusy(e.id);
    try {
      await be().setAutostart(e.id, on);
      setFail(null);
      await refresh();
    } catch (err) {
      setFail(`${e.name} : ${errText(err)}`);
    } finally {
      setBusy(null);
    }
  };

  const b = data?.boot;
  const apps = data?.autostart.filter(a => !a.component) ?? [];
  const comps = data?.autostart.filter(a => a.component) ?? [];
  const maxSlow = Math.max(1, ...(data?.slowest.map(s => s.seconds) ?? []));
  const sub = b?.totalS != null ? `Dernier démarrage en ${secs(b.totalS)}${snap ? ` · allumé depuis ${duration(snap.uptimeS)}` : ''}` : data?.bootDetail ?? 'Lecture…';

  return (
    <>
      <PageHeader title="Démarrage" sub={sub} />
      <div className="sw-grid" style={{ gridTemplateRows: '128px minmax(320px, 1fr)', minHeight: 'calc(128px + 320px + var(--space-4))' }}>
        <Widget span={3}><MetricCard kind="text" label="Démarrage" pct={0} value={split(b?.totalS ?? null)[0]} unit={split(b?.totalS ?? null)[1]} sub="jusqu’au bureau" title={data?.bootDetail ?? undefined} /></Widget>
        <Widget span={3}><MetricCard kind="text" label="Firmware" pct={0} value={split(sum(b?.firmwareS ?? null, b?.loaderS ?? null))[0]} unit={split(sum(b?.firmwareS ?? null, b?.loaderS ?? null))[1]} sub="UEFI + chargeur" /></Widget>
        <Widget span={3}><MetricCard kind="text" label="Noyau" pct={0} value={split(sum(b?.kernelS ?? null, b?.initrdS ?? null))[0]} unit={split(sum(b?.kernelS ?? null, b?.initrdS ?? null))[1]} sub="noyau + initrd" /></Widget>
        <Widget span={3}><MetricCard kind="text" label="Services" pct={0} value={split(b?.userspaceS ?? null)[0]} unit={split(b?.userspaceS ?? null)[1]} sub="espace utilisateur" /></Widget>

        <Widget span={8}>
          <Card title="Programmes au démarrage" right={fail ? <span className="sw-perr" role="alert"><Icon name="warn" size={14} />{fail}</span> : <Sec>à l’ouverture de session</Sec>}>
            {error ? <Empty>{error}</Empty> : !data ? <Empty>Lecture…</Empty> : (
              <div className="sw-rows scroll">
                {apps.length === 0 && <div className="sw-sec" style={{ padding: 'var(--space-3) 0' }}>Aucun programme ajouté au démarrage.</div>}
                {apps.map(a => (
                  <SettingRow key={a.id} title={a.name} desc={a.comment ?? a.command ?? undefined}>
                    <span className="sw-inl">
                      <Sec>{a.source === 'user' ? 'ajouté par vous' : 'installé'}</Sec>
                      <Switch on={a.enabled} label={`Lancer ${a.name} au démarrage`} onChange={v => busy == null && toggle(a, v)} />
                    </span>
                  </SettingRow>
                ))}
                {comps.length > 0 && <div className="sw-label" style={{ marginTop: 'var(--space-4)' }}>Composants du bureau</div>}
                {comps.map(a => (
                  <SettingRow key={a.id} title={a.name} desc={a.comment ?? undefined}>
                    <Sec>{a.enabled ? 'Géré par le bureau' : 'Désactivé'}</Sec>
                  </SettingRow>
                ))}
              </div>
            )}
          </Card>
        </Widget>
        <Widget span={4}>
          <Card title="Services les plus lents" right={<Sec>systemd</Sec>}>
            {!data ? <Empty>Lecture…</Empty> : data.slowest.length === 0 ? <Empty>Aucune mesure fournie par systemd.</Empty> : (
              <div className="sw-rows">
                {data.slowest.map(s => <MeterRow key={s.unit} label={s.unit} pct={(s.seconds / maxSlow) * 100} th={NO_THRESHOLD} value={secs(s.seconds)} />)}
              </div>
            )}
          </Card>
        </Widget>
      </div>
    </>
  );
}
