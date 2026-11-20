import { useEffect, useState } from 'react';
import { Card, Empty } from './components/Card';
import { PAGES, PageHeader, Sidebar, Titlebar, type PageId } from './components/Shell';
import { updateSettings, useSettings } from './lib/settings';
import { useLive } from './lib/store';
import { BatteryPage } from './pages/BatteryPage';
import { CpuPage } from './pages/CpuPage';
import { GpuPage } from './pages/GpuPage';
import { HomePage } from './pages/HomePage';
import { MemoryPage } from './pages/MemoryPage';
import { NetworkPage } from './pages/NetworkPage';
import { ProcessesPage } from './pages/ProcessesPage';
import { StartupPage } from './pages/StartupPage';
import { SettingsPage } from './pages/SettingsPage';

/** Étape de livraison prévue pour chaque page pas encore construite. */
const PLANNED: Partial<Record<PageId, number>> = { disk: 4, fan: 5, alert: 6 };

function Placeholder({ id }: { id: PageId }) {
  const name = PAGES.find(p => p !== '|' && p[0] === id)?.[1] ?? '';
  return (
    <>
      <PageHeader title={name} />
      <Card title={name} className="flex-1">
        <Empty>Cette page arrive à l'étape {PLANNED[id]} du développement.</Empty>
      </Card>
    </>
  );
}

function SelfMemFooter({ page, onNavigate, collapsed }: { page: PageId; onNavigate: (p: PageId) => void; collapsed: boolean }) {
  const { snap } = useLive();
  return (
    <Sidebar active={page} onNavigate={onNavigate} alerts={0} selfMem={snap?.selfMemBytes ?? null}
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

  // Ramène la zone principale en haut à chaque changement de page.
  useEffect(() => {
    document.querySelector('.sw-main')?.scrollTo(0, 0);
  }, [page]);

  return (
    <div className={`sw-app${settings.sidebarCollapsed ? ' is-collapsed' : ''}`}>
      <Titlebar />
      <div className="sw-body">
        <SelfMemFooter page={page} onNavigate={setPage} collapsed={settings.sidebarCollapsed} />
        <main className="sw-main">
          {page === 'home' ? <HomePage /> : page === 'cpu' ? <CpuPage /> : page === 'gpu' ? <GpuPage /> : page === 'ram' ? <MemoryPage />
            : page === 'bat' ? <BatteryPage /> : page === 'proc' ? <ProcessesPage /> : page === 'net' ? <NetworkPage /> : page === 'boot' ? <StartupPage /> : page === 'cog' ? <SettingsPage /> : <Placeholder id={page} />}
        </main>
      </div>
    </div>
  );
}
