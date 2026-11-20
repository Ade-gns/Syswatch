// Page Ventilateurs — maquette « FansScreen » + composant « FanControl » : profils
// Silencieux / Jeu / Performance (cartes exclusives), bascule Auto, boutons Faible (35 %) /
// Moyen (60 %) / Fort (100 %) à barres de signal, courbe température → vitesse, historique
// et capteurs. Choisir un niveau coupe l'Auto ; rallumer l'Auto efface le niveau.
//
// Ce que la machine ne permet pas est désactivé avec sa raison :
// - pilote sans consigne pwm (hp-wmi…) : Auto (firmware) et Fort (pleine vitesse) seulement,
//   courbe grisée ; les profils passent alors par power-profiles-daemon ;
// - service SysWatch absent : contrôle en lecture seule, avec la commande d'installation.
import { useMemo, useState } from 'react';
import { Badge, Card, Empty, Legend, MeterRow, Sec, Widget } from '../components/Card';
import { Segmented } from '../components/Controls';
import { CurveEditor, type Points } from '../components/CurveEditor';
import { Ring } from '../components/Gauges';
import { Icon, type IconName } from '../components/Icon';
import { LiveChart } from '../components/LiveChart';
import { PageHeader } from '../components/Shell';
import { be, errText } from '../lib/api';
import { num, tempStr } from '../lib/format';
import { NO_THRESHOLD, sensorThresholds } from '../lib/levels';
import { usePoll } from '../lib/poll';
import { updateSettings, useSettings } from '../lib/settings';
import { useLive } from '../lib/store';
import type { FanMode, FanProfile, SensorKind } from '../lib/types';

type Lvl = 'faible' | 'moyen' | 'fort';
const LEVELS: [Lvl, string, number, number][] = [['faible', 'Faible', 35, 1], ['moyen', 'Moyen', 60, 2], ['fort', 'Fort', 100, 3]];
const PROFILES: [FanProfile, IconName, string, string][] = [
  ['silencieux', 'moon', 'Silencieux', 'Max 2 800 tr/min · bruit minimal'],
  ['jeu', 'game', 'Jeu', 'Monte dès 60 °C · équilibré'],
  ['performance', 'bolt', 'Performance', 'Refroidissement maximal'],
];
/** Préréglages identiques à syswatch-fans (Curve::preset). */
const PRESETS: Record<FanProfile, Points> = {
  silencieux: [[30, 20], [50, 25], [65, 35], [80, 55], [90, 100]],
  jeu: [[30, 20], [45, 28], [60, 45], [75, 75], [88, 100]],
  performance: [[30, 40], [45, 55], [60, 75], [70, 90], [80, 100]],
};
/** Sans pwm, les profils pilotent le profil d'énergie du système (le firmware règle la ventilation). */
const PPD: Record<FanProfile, string> = { silencieux: 'power-saver', jeu: 'balanced', performance: 'performance' };
const PPD_DESC: Record<FanProfile, string> = { silencieux: 'Profil d’énergie « économie »', jeu: 'Profil d’énergie « équilibré »', performance: 'Profil d’énergie « performance »' };
const SENSOR_KINDS: [SensorKind, string][] = [['cpu', 'CPU'], ['gpu', 'GPU'], ['ssd', 'SSD NVMe'], ['board', 'Châssis']];

const levelOf = (m: FanMode): Lvl | null =>
  m.mode === 'max' ? 'fort' : m.mode === 'manual' ? (m.pct >= 100 ? 'fort' : m.pct >= 60 ? 'moyen' : 'faible') : null;

export function FansPage() {
  const { snap, times, get, peaks, historyMs } = useLive();
  const settings = useSettings();
  const { data: st, refresh } = usePoll(() => be().fanStatus(), 3000);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [lastLvl, setLastLvl] = useState<Lvl>('moyen');

  const channels = st?.channels ?? [];
  const full = channels.filter(c => c.control === 'full');
  const canCurve = full.length > 0;
  const helperOk = !!st?.helper.installed && !st.helper.detail;
  const mode = channels[0]?.mode ?? { mode: 'auto' };
  const auto = mode.mode === 'auto' || mode.mode === 'curve';
  const lvl = levelOf(mode);
  const cpuT = snap?.cpu.tempC ?? null;
  const ppd = st?.powerProfiles ?? null;
  const profilesViaPpd = !canCurve && !!ppd;
  const activeProfile: FanProfile | null = canCurve
    ? settings.fanProfile
    : ppd ? ((Object.keys(PPD) as FanProfile[]).find(k => PPD[k] === ppd.active) ?? null) : null;

  /** Applique un mode à tous les canaux (les canaux sans pwm reçoivent l'équivalent possible). */
  const run = async (f: () => Promise<void>) => {
    setBusy(true);
    try {
      await f();
      setErr(null);
    } catch (e) {
      setErr(errText(e));
    } finally {
      setBusy(false);
      refresh();
    }
  };
  const applyAll = (forFull: FanMode, forEnableOnly: FanMode) =>
    run(async () => { for (const c of channels) await be().setFanMode(c.id, c.control === 'full' ? forFull : forEnableOnly); });
  const curveMode = (points: Points): FanMode => ({ mode: 'curve', curve: { points } });

  const onAuto = (on: boolean) => {
    if (on) return applyAll(curveMode(settings.fanCurve), { mode: 'auto' });
    const l = canCurve ? lastLvl : 'fort';
    return onLevel(l);
  };
  const onLevel = (l: Lvl) => {
    setLastLvl(l);
    const pct = LEVELS.find(x => x[0] === l)![2];
    return applyAll(pct >= 100 ? { mode: 'max' } : { mode: 'manual', pct }, { mode: 'max' });
  };
  const onCurve = (points: Points) => {
    updateSettings({ fanCurve: points });
    if (auto && canCurve && helperOk) applyAll(curveMode(points), { mode: 'auto' });
  };
  const onProfile = (p: FanProfile) => {
    if (canCurve) {
      updateSettings({ fanProfile: p, fanCurve: PRESETS[p] });
      if (helperOk) applyAll(curveMode(PRESETS[p]), { mode: 'auto' });
    } else if (ppd) {
      run(() => be().setPowerProfile(PPD[p]));
    }
  };

  const sensors = useMemo(() => {
    if (!snap) return [];
    return SENSOR_KINDS.flatMap(([k, label]) => {
      const s = snap.sensors.filter(x => x.kind === k).sort((a, b) => b.valueC - a.valueC)[0];
      return s ? [{ ...s, label: k === 'board' ? label : s.label.split(' · ')[0] }] : [];
    });
  }, [snap]);

  if (!snap) return <Empty>Lecture des capteurs…</Empty>;
  const rpmFans = snap.fans;
  const driver = channels[0]?.chip ?? snap.fans[0]?.id.split('/')[0];
  const sub = `${rpmFans.length} ventilateur${rpmFans.length > 1 ? 's' : ''} détecté${rpmFans.length > 1 ? 's' : ''}${driver ? ` · pilotage via ${driver === 'hp' ? 'hp-wmi' : driver}` : ''}`;
  const controlsDisabled = !helperOk || busy;
  const driverName = channels[0] ? (channels[0].chip === 'hp' ? 'hp-wmi' : channels[0].chip) : '';
  const helperMissing = !!st && !st.helper.installed;
  // Note d'une ligne sous les boutons (le détail complet est dans l'info-bulle).
  const reason = !st ? null : helperMissing ? 'Service SysWatch non installé : lecture seule'
    : !helperOk ? st.helper.detail
    : !channels.length ? 'Aucun ventilateur pilotable détecté'
    : !canCurve ? `${driverName} : automatique et pleine vitesse seulement` : null;

  // Historique : vitesse du premier ventilateur en % de son pic (ou de sa consigne pwm).
  const f0 = rpmFans[0];
  const f0peak = f0 ? peaks[`fan:${f0.id}`] : undefined;
  const fanPct = f0 ? get(`fan:${f0.id}`).map(v => (f0peak ? (v / f0peak) * 100 : NaN)) : [];

  return (
    <>
      <PageHeader title="Ventilateurs" sub={sub} actions={
        <>
          <Sec>Profil</Sec>
          <Segmented label="Profil de ventilation" value={activeProfile ?? ('' as FanProfile)} onChange={onProfile}
            items={PROFILES.map(([v, ic, n]) => ({ value: v, label: n, icon: ic }))} />
        </>
      } />
      <div className="sw-grid" style={{ gridTemplateRows: '88px 336px minmax(200px, 1fr)', minHeight: 'calc(88px + 336px + 200px + 2 * var(--space-4))' }}>
        {PROFILES.map(([id, ic, name, desc]) => (
          <Widget span={4} key={id}>
            <button type="button" className="sw-card sw-prof" aria-pressed={activeProfile === id} onClick={() => onProfile(id)}
              disabled={!canCurve && !ppd} title={!canCurve && !ppd ? 'Ni courbe ni profil d’énergie disponibles sur cette machine' : undefined}>
              <span className="ico"><Icon name={ic} size={20} /></span>
              <span className="tx"><b>{name}</b><span>{profilesViaPpd ? PPD_DESC[id] : desc}</span></span>
              {activeProfile === id && <Badge s="acc">Actif</Badge>}
            </button>
          </Widget>
        ))}

        <Widget span={5}>
          <Card title="Contrôle" right={auto ? <Badge s="acc">Auto</Badge> : <Badge s="acc">Manuel</Badge>}>
            <div className="sw-fc-auto">
              <div>
                <div className="sw-h3">Mode automatique</div>
                <div className="sw-sec">{canCurve ? 'Suit la courbe température → vitesse' : 'Géré par le firmware de la machine'}</div>
              </div>
              <button className="sw-switch" type="button" role="switch" aria-checked={auto} aria-label="Mode automatique"
                disabled={controlsDisabled} onClick={() => onAuto(!auto)} />
            </div>
            <div className="sw-fanbtns" role="group" aria-label="Vitesse manuelle">
              {LEVELS.map(([v, label, pct, bars]) => {
                const unsupported = !canCurve && v !== 'fort';
                return (
                  <button key={v} type="button" className="sw-fanbtn" aria-pressed={!auto && lvl === v} disabled={controlsDisabled || unsupported}
                    title={unsupported ? 'Non pris en charge par ce pilote' : undefined} onClick={() => onLevel(v)}>
                    <span className="sw-sig" aria-hidden="true">{[1, 2, 3].map(i => <i key={i} className={i <= bars ? 'on' : ''} style={{ height: 6 + i * 5 }} />)}</span>
                    <b>{label}</b><span className="sw-sec">{pct}&nbsp;%</span>
                  </button>
                );
              })}
            </div>
            {(err || reason) && (
              <div className={`sw-note${err ? ' is-err' : ''}`} role={err ? 'alert' : undefined} title={err ?? st?.helper.detail ?? reason ?? undefined}>
                <Icon name={err ? 'warn' : 'info'} size={14} /><span>{err ?? reason}</span>
              </div>
            )}
            <div className="sw-fans">
              {rpmFans.length === 0 && <span className="sw-sec">Aucun compteur de tours exposé.</span>}
              {rpmFans.slice(0, 3).map(f => {
                const peak = peaks[`fan:${f.id}`];
                const pct = f.pct ?? (peak && f.rpm != null ? (f.rpm / peak) * 100 : 0);
                return (
                  <div className="sw-fan" key={f.id}>
                    <Ring pct={pct} size={44} stroke={5} text="" label={f.label} th={NO_THRESHOLD} />
                    <div>
                      <div className="nm">{f.label}</div>
                      <div className="sw-sec">{f.pct != null ? `${num(f.pct)} % de la vitesse max.` : peak ? `${num(pct)} % du pic observé` : 'à l’arrêt'}</div>
                    </div>
                    <div className="sw-val md">{f.rpm != null ? num(f.rpm) : '—'}<small>tr/min</small></div>
                  </div>
                );
              })}
            </div>
          </Card>
        </Widget>
        <Widget span={7}>
          <Card title="Courbe température → vitesse" right={<Sec>{canCurve ? 'Glissez les points · flèches au clavier' : 'Non disponible sur ce pilote'}</Sec>}>
            <div style={{ flex: 1, minHeight: 0, position: 'relative' }}>
              <CurveEditor points={settings.fanCurve} temp={cpuT} h={250} disabled={!canCurve || !helperOk} onCommit={onCurve} />
              {helperMissing ? (
                <div className="sw-empty sw-veil">
                  <div className="sw-install">
                    <div>Le pilotage passe par le service privilégié de SysWatch, qui n’est pas installé.</div>
                    <div className="sw-sec">Dans un terminal, à la racine du projet :</div>
                    <code>cargo build --release -p syswatch-helper</code>
                    <code>sudo ./scripts/install-helper.sh</code>
                  </div>
                </div>
              ) : !canCurve && st && (
                <div className="sw-empty sw-veil">
                  Ce pilote n’expose pas de consigne de vitesse (pwm) : la courbe ne peut pas être appliquée.
                  {ppd ? ' Utilisez les profils, qui règlent le profil d’énergie du système.' : ''}
                </div>
              )}
            </div>
          </Card>
        </Widget>

        <Widget span={8}>
          <Card title="Historique" right={<Legend items={[{ name: 'Température CPU', color: 'var(--accent)' }, { name: 'Vitesse ventilateur', color: 'var(--series-2)', style: 'd' }]} />}>
            <LiveChart label="Température CPU et vitesse du ventilateur" max={100} times={times} spanMs={historyMs} series={[
              { name: 'Température CPU', color: 'var(--accent)', values: get('cpuTemp'), unit: '°C' },
              { name: 'Vitesse ventilateur', color: 'var(--series-2)', values: fanPct, unit: '%' },
            ]} />
          </Card>
        </Widget>
        <Widget span={4}>
          <Card title="Capteurs" right={<Sec>°C</Sec>}>
            {sensors.length ? (
              <div className="sw-rows">
                {sensors.map(s => <MeterRow key={s.id} label={s.label} pct={s.valueC} th={sensorThresholds(s.kind)} value={tempStr(s.valueC, settings.tempUnit)} />)}
              </div>
            ) : <Empty>Aucun capteur de température lisible.</Empty>}
          </Card>
        </Widget>
      </div>
    </>
  );
}

