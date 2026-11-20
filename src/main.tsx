import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { backend } from './lib/api';
import { initSettings } from './lib/settings';
import { pushSnapshot, setSystemInfo } from './lib/store';
import './index.css';

async function boot() {
  const be = await backend();
  const [info, settings] = await Promise.all([be.getSystemInfo(), be.getSettings()]);
  setSystemInfo(info);
  initSettings(be, settings);
  await be.onSnapshot(pushSnapshot);

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
