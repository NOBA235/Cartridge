import { MotionConfig } from 'motion/react';
import { lazy, Suspense, useSyncExternalStore } from 'react';
import { cn } from '@/lib/utils';
import { offlineShell } from '@/offline/register';
import { CartridgeSlot } from '@/ui/components/CartridgeSlot';
import { EgressPanel } from '@/ui/components/EgressPanel';
import { ThemeToggle } from '@/ui/components/ThemeToggle';
import { egressPanel } from '@/ui/egressPanelState';
import { useEgressLog } from '@/ui/hooks/useStores';
import { Button } from '@/ui/primitives/button';
import { linkHandler, usePath, type AppPath } from '@/ui/router';
import { Ask } from '@/ui/screens/Ask';
import { CartridgeView } from '@/ui/screens/CartridgeView';
import { ConnectionTest } from '@/ui/screens/ConnectionTest';
import { DevPage } from '@/ui/screens/DevPage';
import { ExamDay } from '@/ui/screens/ExamDay';
import { LoadRulebook } from '@/ui/screens/LoadRulebook';
import { ReportCard } from '@/ui/screens/ReportCard';
import { Versions } from '@/ui/screens/Versions';
import { Welcome } from '@/ui/screens/Welcome';

const NAV: ReadonlyArray<{ path: AppPath; label: string }> = [
  { path: '/', label: 'Welcome' },
  { path: '/load', label: 'Load a rulebook' },
  { path: '/exam', label: 'Exam Day' },
  { path: '/ask', label: 'Ask' },
  { path: '/report', label: 'Report card' },
  { path: '/blueprint', label: 'Blueprint' },
];

// Excalidraw is large; it loads only when the Blueprint canvas opens.
const Blueprint = lazy(() => import('@/ui/screens/Blueprint'));

function Screen({ path }: { path: AppPath }) {
  if (path === '/blueprint') {
    return (
      <Suspense
        fallback={<p className="py-10 text-sm text-muted-foreground">Loading the canvas…</p>}
      >
        <Blueprint />
      </Suspense>
    );
  }
  if (path === '/dev') return <DevPage />;
  if (path === '/load') return <LoadRulebook />;
  if (path === '/cartridge') return <CartridgeView />;
  if (path === '/versions') return <Versions />;
  if (path === '/ask') return <Ask />;
  if (path === '/exam') return <ExamDay />;
  if (path === '/report') return <ReportCard />;
  if (path === '/connections') return <ConnectionTest />;
  return <Welcome />;
}

export function App() {
  const path = usePath();
  const egressOpen = useSyncExternalStore(egressPanel.subscribe, egressPanel.get);
  const offline = useSyncExternalStore(offlineShell.subscribe, offlineShell.get);
  const entries = useEgressLog();
  const cloudCalls = entries.filter((e) => e.kind === 'cloud-call').length;

  return (
    <MotionConfig reducedMotion="user">
      <a
        href="#main"
        className="sr-only z-50 rounded-md bg-primary px-3 py-2 text-sm text-primary-foreground focus:not-sr-only focus:fixed focus:top-2 focus:left-2"
      >
        Skip to content
      </a>
      <div className="flex min-h-svh flex-col">
        <header className="flex flex-wrap items-center justify-between gap-3 border-b px-6 py-3">
          <div className="flex flex-wrap items-center gap-6">
            <a
              href="/"
              onClick={linkHandler('/')}
              className="rounded-md font-semibold tracking-tight outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
            >
              Cartridge
            </a>
            <nav aria-label="Main">
              <ul className="flex flex-wrap gap-1">
                {NAV.map((n) => (
                  <li key={n.path}>
                    <a
                      href={n.path}
                      onClick={linkHandler(n.path)}
                      aria-current={path === n.path ? 'page' : undefined}
                      className={cn(
                        'rounded-md px-3 py-1.5 text-sm text-muted-foreground outline-none hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50',
                        path === n.path && 'bg-secondary text-foreground',
                      )}
                    >
                      {n.label}
                    </a>
                  </li>
                ))}
              </ul>
            </nav>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <CartridgeSlot />
            <Button
              variant="outline"
              size="sm"
              onClick={() => egressPanel.open()}
              aria-haspopup="dialog"
            >
              What left this device ({cloudCalls})
            </Button>
            <ThemeToggle />
          </div>
        </header>
        <main id="main" tabIndex={-1} className="flex-1 px-6 outline-none">
          <Screen path={path} />
        </main>
        <footer className="flex flex-wrap justify-between gap-2 border-t px-6 py-3 text-xs text-muted-foreground">
          <span>Reference tool, not an official authority.</span>
          {offline === 'ready' && (
            <span>Saved on this device: the app opens without a signal.</span>
          )}
        </footer>
      </div>
      <EgressPanel open={egressOpen} onClose={egressPanel.close} />
    </MotionConfig>
  );
}
