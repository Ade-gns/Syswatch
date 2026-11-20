import { useEffect, useState } from 'react';
import { PAGES, Sidebar, Titlebar, type PageId } from './components/Shell';
import { updateSettings, useSettings } from './lib/settings';
import { useAlerts } from './lib/alerts';
import { useEditing } from './lib/editMode';
import { useLive } from './lib/store';
import { useUpdate } from './lib/update';
import { AlertsPage } from './pages/AlertsPage';
import { BatteryPage } from './pages/BatteryPage';
import { CpuPage } from './pages/CpuPage';
import { DisksPage } from './pages/DisksPage';
import { FansPage } from './pages/FansPage';
import { GpuPage } from './pages/GpuPage';
import { HomePage } from './pages/HomePage';
import { MemoryPage } from './pages/MemoryPage';
import { NetworkPage } from './pages/NetworkPage';
import { ProcessesPage } from './pages/ProcessesPage';
import { StartupPage } from './pages/StartupPage';
import { SettingsPage } from './pages/SettingsPage';


function SelfMemFooter({ page, onNavigate, collapsed }: { page: PageId; onNavigate: (p: PageId) => void; collapsed: boolean }) {
  const { snap } = useLive();
  const { unread } = useAlerts();
  const { info } = useUpdate();
  return (
    <Sidebar active={page} onNavigate={onNavigate} alerts={unread} selfMem={snap?.selfMemBytes ?? null} update={info?.version ?? null}
      onToggle={() => updateSettings({ sidebarCollapsed: !collapsed })} />
  );
}

export function App() {
  // Page initiale lisible depuis l'URL (#cpu…) : pratique pour comparer avec les maquettes.
  const [page, setPage] = useState<PageId>(() => {
    const h = location.hash.slice(1);
    return PAGES.some(p => p !== '|' && p[0] === h) ? (h as PageId) : 'home';
  });
  const settings = useSettings();
  const editing = useEditing();

  // Ramène la zone principale en haut à chaque changement de page.
  useEffect(() => {
    document.querySelector('.sw-main')?.scrollTo(0, 0);
  }, [page]);

  return (
    <div className={`sw-app${settings.sidebarCollapsed || editing ? ' is-collapsed' : ''}${editing ? ' is-edit' : ''}`}>
      <Titlebar />
      <div className="sw-body">
        <SelfMemFooter page={page} onNavigate={setPage} collapsed={settings.sidebarCollapsed || editing} />
        <main className="sw-main">
          {page === 'home' ? <HomePage /> : page === 'cpu' ? <CpuPage /> : page === 'gpu' ? <GpuPage /> : page === 'ram' ? <MemoryPage /> : page === 'disk' ? <DisksPage />
            : page === 'bat' ? <BatteryPage /> : page === 'proc' ? <ProcessesPage /> : page === 'net' ? <NetworkPage /> : page === 'boot' ? <StartupPage /> : page === 'fan' ? <FansPage /> : page === 'alert' ? <AlertsPage /> : <SettingsPage />}
        </main>
      </div>
    </div>
  );
}
