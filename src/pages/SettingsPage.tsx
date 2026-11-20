// Page Paramètres — maquette « SettingsScreen ». Étape 1 : carte « Général » avec la
// fréquence de rafraîchissement (maquette) et la durée d'historique des courbes.
// Apparence, widget compact et mode jeu arrivent aux étapes 6 et 7.
import { Card, Widget } from '../components/Card';
import { Segmented, SettingRow } from '../components/Controls';
import { PageHeader } from '../components/Shell';
import { updateSettings, useSettings } from '../lib/settings';

export function SettingsPage() {
  const s = useSettings();
  return (
    <>
      <PageHeader title="Paramètres" sub="Réglages généraux" />
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
            </Card>
          </Widget>
        </div>
      </div>
    </>
  );
}
