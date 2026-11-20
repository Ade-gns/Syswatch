// Page Paramètres — maquette « SettingsScreen » : colonne gauche Apparence et Général,
// colonne droite Widget compact et Mode jeu. Changer le thème ou la couleur recolore toute
// la fenêtre ; une couleur libre recalcule `--on-accent` ; `warn` et `crit` ne changent jamais.
import { type CSSProperties, useEffect, useState } from 'react';
import { Badge, Card, Widget } from '../components/Card';
import { Bar, Ring } from '../components/Gauges';
import { accentValue, contrast, resolveTheme } from '../lib/accent';
import { ACCENT_PRESETS } from '../lib/tokens.gen';
import { Segmented, SettingRow, Switch } from '../components/Controls';
import { PageHeader } from '../components/Shell';
import { be, errText } from '../lib/api';
import { usePoll } from '../lib/poll';
import { updateSettings, useSettings } from '../lib/settings';
import type { Corner, OverlayItem, OverlaySettings, WidgetSettings } from '../lib/types';

const CORNERS: [Corner, string][] = [['hg', 'Haut gauche'], ['hd', 'Haut droite'], ['bg', 'Bas gauche'], ['bd', 'Bas droite']];
const ITEMS: [OverlayItem, string][] = [['fps', 'FPS'], ['cpu', 'CPU'], ['gpu', 'GPU'], ['ram', 'RAM'], ['vram', 'VRAM'], ['temp', 'Temp.'], ['net', 'Réseau'], ['battery', 'Batterie']];

function CornerPicker({ value, onChange, label }: { value: Corner; onChange: (c: Corner) => void; label: string }) {
  return (
    <div className="sw-corner" role="group" aria-label={label}>
      {CORNERS.map(([c, name]) => <button key={c} type="button" aria-pressed={c === value} aria-label={name} onClick={() => onChange(c)} />)}
    </div>
  );
}

function AppearanceCard() {
  const s = useSettings();
  const theme = resolveTheme(s.theme);
  const current = accentValue(s.accent, theme);
  const custom = !ACCENT_PRESETS.some(p => p.id === s.accent);
  const [hex, setHex] = useState(current.toUpperCase());
  useEffect(() => setHex(current.toUpperCase()), [current]);
  // README : une couleur libre claire passe aussi en thème clair ; avertir si le contraste
  // avec `surface-2` est inférieur à 4,5:1.
  const surface = getComputedStyle(document.documentElement).getPropertyValue('--surface-2').trim() || '#ffffff';
  const ratio = custom ? contrast(current, surface) : null;
  const setColor = (v: string) => /^#[0-9a-f]{6}$/i.test(v) && updateSettings({ accent: v.toLowerCase() });
  return (
    <Card title="Apparence">
      <SettingRow title="Thème" desc="Clair, sombre ou celui du système">
        <Segmented label="Thème" value={s.theme} onChange={v => updateSettings({ theme: v })}
          items={[{ value: 'dark', label: 'Sombre', icon: 'moon' }, { value: 'light', label: 'Clair', icon: 'sun' }, { value: 'system', label: 'Système' }]} />
      </SettingRow>
      <div className="sw-set" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 10, padding: '12px 0' }}>
        <div>
          <div>Couleur d’accent</div>
          <div className="d">Jauges, courbes et éléments actifs. Les alertes restent jaune et rouge.</div>
        </div>
        <div className="sw-swatches" role="group" aria-label="Préréglages d’accent">
          {ACCENT_PRESETS.map(p => (
            <button key={p.id} type="button" className="sw-sw" aria-label={p.name} aria-pressed={s.accent === p.id}
              style={{ '--c': p[theme] } as CSSProperties} onClick={() => updateSettings({ accent: p.id })} />
          ))}
        </div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <input className="sw-colorin" type="color" value={current} aria-label="Choisir une couleur personnalisée" onChange={e => setColor(e.target.value)} />
          <input className="sw-input" value={hex} style={{ width: 112 }} aria-label="Code hexadécimal"
            onChange={e => setHex(e.target.value)} onBlur={() => { if (!setColor(hex)) setHex(current.toUpperCase()); }}
            onKeyDown={e => e.key === 'Enter' && (e.target as HTMLInputElement).blur()} />
          <span className="d">Personnalisée</span>
        </div>
        {ratio != null && ratio < 4.5 && (
          <div className="sw-note"><span>Contraste de {ratio.toFixed(1).replace('.', ',')}:1 avec les cartes, sous le minimum de 4,5:1 : texte d’accent peu lisible.</span></div>
        )}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 20, paddingTop: 12, borderTop: '1px solid var(--border)' }}>
        <span className="sw-label">Aperçu</span>
        <Ring pct={34} size={56} stroke={6} label="Normal" />
        <Ring pct={82} size={56} stroke={6} label="Attention" />
        <Ring pct={94} size={56} stroke={6} label="Critique" />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, flex: 1 }}>
          <div className="l-ok"><Bar pct={58} h={8} /></div>
          <div style={{ display: 'flex', gap: 8 }}><button className="sw-btn pri sm" type="button">Primaire</button><Badge s="acc">Accent</Badge></div>
        </div>
      </div>
    </Card>
  );
}

function LaunchRow() {
  const { data, refresh } = usePoll(() => be().getLaunchAtLogin(), null);
  const [err, setErr] = useState<string | null>(null);
  return (
    <SettingRow title="Lancer au démarrage" desc={err ?? 'Démarre réduit dans la zone de notification'}>
      <Switch on={!!data} label="Lancer au démarrage" onChange={async v => {
        try {
          await be().setLaunchAtLogin(v);
          setErr(null);
        } catch (e) {
          setErr(errText(e));
        }
        refresh();
      }} />
    </SettingRow>
  );
}

function WidgetCard() {
  const s = useSettings();
  const w = s.widget;
  const set = (p: Partial<WidgetSettings>) => updateSettings({ widget: { ...w, ...p } });
  return (
    <Card title="Widget compact" right={w.enabled ? <Badge s="ok">Actif</Badge> : <Badge s="acc">Masqué</Badge>}>
      <SettingRow title="Afficher le widget" desc="Toujours visible sur le bureau, clic traversant">
        <Switch on={w.enabled} label="Afficher le widget" onChange={v => set({ enabled: v })} />
      </SettingRow>
      <SettingRow title="Style">
        <Segmented label="Style du widget" value={w.style} onChange={v => set({ style: v })} items={[{ value: 'bar', label: 'Barre' }, { value: 'card', label: 'Carte' }, { value: 'pill', label: 'Pastille' }]} />
      </SettingRow>
      <SettingRow title="Position"><CornerPicker label="Position du widget" value={w.corner} onChange={c => set({ corner: c })} /></SettingRow>
      <SettingRow title="Opacité">
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, width: 170 }}>
          <input className="sw-range" type="range" min={30} max={100} value={w.opacity} aria-label="Opacité du widget" onChange={e => set({ opacity: Number(e.target.value) })} />
          <span className="sw-sec" style={{ width: 44, textAlign: 'right' }}>{w.opacity} %</span>
        </div>
      </SettingRow>
      <SettingRow title="Toujours au premier plan">
        <Switch on={w.onTop} label="Toujours au premier plan" onChange={v => set({ onTop: v })} />
      </SettingRow>
    </Card>
  );
}

function GameCard() {
  const s = useSettings();
  const o = s.overlay;
  const set = (p: Partial<OverlaySettings>) => updateSettings({ overlay: { ...o, ...p } });
  const mh = usePoll(() => be().mangohudStatus(), null);
  const [msg, setMsg] = useState<string | null>(null);
  const toggleItem = (i: OverlayItem, on: boolean) => set({ items: on ? [...o.items, i] : o.items.filter(x => x !== i) });
  const setup = async () => {
    try {
      const path = await be().setupMangohud();
      setMsg(`Ajouté à ${path}. Relancez le jeu.`);
      mh.refresh();
    } catch (e) {
      setMsg(errText(e));
    }
  };
  const m = mh.data;
  return (
    <Card title="Mode jeu" right={o.enabled ? <Badge s="acc">Overlay prêt</Badge> : <Badge s="acc">Désactivé</Badge>}>
      <SettingRow title="Overlay FPS en jeu" desc="Affiché par-dessus la fenêtre du jeu">
        <Switch on={o.enabled} label="Overlay FPS" onChange={v => set({ enabled: v })} />
      </SettingRow>
      <SettingRow title="Détecter les jeux automatiquement" desc="Jeux lancés avec MangoHud (Steam, Lutris, Heroic)">
        <Switch on={o.autoShow} label="Détection automatique" onChange={v => set({ autoShow: v })} />
      </SettingRow>
      <SettingRow title="FPS via MangoHud" desc={!m ? '' : !m.installed ? 'MangoHud n’est pas installé' : m.configured ? 'Journal lu en direct par SysWatch' : (msg ?? 'Journalisation à activer dans MangoHud.conf')}>
        {m?.installed && !m.configured ? <button type="button" className="sw-btn sm" onClick={setup}>Configurer</button> : <span className="sw-sec">{m?.configured ? 'Prêt' : '—'}</span>}
      </SettingRow>
      <div className="sw-set" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 8, padding: '12px 0' }}>
        <div>Éléments affichés</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, auto)', justifyContent: 'start', gap: '8px 22px' }}>
          {ITEMS.map(([i, label]) => (
            <label key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
              <input className="sw-chk" type="checkbox" checked={o.items.includes(i)} onChange={e => toggleItem(i, e.target.checked)} />{label}
            </label>
          ))}
        </div>
      </div>
      <SettingRow title="Style">
        <Segmented label="Style de l’overlay" value={o.style} onChange={v => set({ style: v })} items={[{ value: 'standard', label: 'Standard' }, { value: 'minimal', label: 'Minimal' }, { value: 'detailed', label: 'Détaillé' }]} />
      </SettingRow>
      <SettingRow title="Position"><CornerPicker label="Position de l’overlay" value={o.corner} onChange={c => set({ corner: c })} /></SettingRow>
      <SettingRow title="Raccourci" desc="Afficher / masquer l’overlay">
        <span><span className="sw-kbd">Ctrl</span> + <span className="sw-kbd">Maj</span> + <span className="sw-kbd">F</span></span>
      </SettingRow>
    </Card>
  );
}

export function SettingsPage() {
  const s = useSettings();
  return (
    <>
      <PageHeader title="Paramètres" sub="Apparence, widget compact et mode jeu" />
      <div className="sw-grid" style={{ gridTemplateColumns: '7fr 5fr', gridTemplateRows: 'auto' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)', minWidth: 0 }}>
          <Widget span={12}><AppearanceCard /></Widget>
          <Widget span={12}>
            <Card title="Général">
              <LaunchRow />
              <SettingRow title="Fréquence de rafraîchissement" desc="Plus rapide = un peu plus de CPU. Fenêtre masquée : toutes les 5 s au moins.">
                <Segmented label="Fréquence de rafraîchissement" value={String(s.intervalMs)} onChange={v => updateSettings({ intervalMs: Number(v) })}
                  items={[{ value: '500', label: '0,5 s' }, { value: '1000', label: '1 s' }, { value: '2000', label: '2 s' }]} />
              </SettingRow>
              <SettingRow title="Historique des courbes" desc="Durée affichée par les graphiques temps réel">
                <Segmented label="Historique des courbes" value={String(s.historyS)} onChange={v => updateSettings({ historyS: Number(v) })}
                  items={[{ value: '60', label: '1 min' }, { value: '300', label: '5 min' }, { value: '600', label: '10 min' }]} />
              </SettingRow>
              <SettingRow title="Unités de température">
                <Segmented label="Unités de température" value={s.tempUnit} onChange={v => updateSettings({ tempUnit: v })}
                  items={[{ value: 'c', label: '°C' }, { value: 'f', label: '°F' }]} />
              </SettingRow>
              <SettingRow title="Fermer dans la zone de notification" desc="Le bouton Fermer garde SysWatch actif (alertes, widget)">
                <Switch on={s.closeToTray} label="Fermer dans la zone de notification" onChange={v => updateSettings({ closeToTray: v })} />
              </SettingRow>
            </Card>
          </Widget>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)', minWidth: 0 }}>
          <Widget span={12}><WidgetCard /></Widget>
          <Widget span={12}><GameCard /></Widget>
        </div>
      </div>
    </>
  );
}
