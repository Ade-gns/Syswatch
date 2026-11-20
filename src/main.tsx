import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { App } from './App';
import { OverlayApp, WidgetApp } from './floating/Floating';
import { initAlerts } from './lib/alerts';
import { backend, inTauri } from './lib/api';
import { initSettings } from './lib/settings';
import { pushSnapshot, setSystemInfo } from './lib/store';
import { initUpdates } from './lib/update';
import './index.css';

async function boot() {
  const be = await backend();
  const [info, settings] = await Promise.all([be.getSystemInfo(), be.getSettings()]);
  setSystemInfo(info);
  initSettings(be, settings);
  await be.onSnapshot(pushSnapshot);

  // Même bundle pour toutes les fenêtres : le libellé choisit l'interface.
  const label = inTauri ? getCurrentWindow().label : (new URLSearchParams(location.search).get('w') ?? 'main');
  if (label === 'widget' || label === 'overlay') {
    document.documentElement.classList.add('is-floating');
    createRoot(document.getElementById('root')!).render(label === 'widget' ? <WidgetApp /> : <OverlayApp />);
    return;
  }
  await initAlerts(be);
  initUpdates(be);

  // Échantillonnage adaptatif : le backend ralentit quand la fenêtre n'est plus visible.
  document.addEventListener('visibilitychange', () => be.setVisible(document.visibilityState === 'visible'));

  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}

boot().catch(e => {
  document.getElementById('root')!.textContent = `Erreur au démarrage : ${e}`;
  console.error(e);
});
