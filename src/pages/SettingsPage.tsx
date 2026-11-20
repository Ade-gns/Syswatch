// Page Paramètres — maquette « SettingsScreen » : colonne gauche Général (Apparence à
// l'étape 7), colonne droite Widget compact et Mode jeu.
import { useState } from 'react';
import { Badge, Card, Widget } from '../components/Card';
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
          <Widget span={12}>
            <Card title="Général">
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
