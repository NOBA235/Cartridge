import { MotionConfig } from 'motion/react';
import { useCallback, useState } from 'react';
import { cn } from '@/lib/utils';
import { EgressPanel } from '@/ui/components/EgressPanel';
import { useEgressLog } from '@/ui/hooks/useStores';
import { Button } from '@/ui/primitives/button';
import { linkHandler, usePath, type AppPath } from '@/ui/router';
import { Ask } from '@/ui/screens/Ask';
import { CartridgeView } from '@/ui/screens/CartridgeView';
import { DevPage } from '@/ui/screens/DevPage';
import { ExamDay } from '@/ui/screens/ExamDay';
import { LoadRulebook } from '@/ui/screens/LoadRulebook';
import { Welcome } from '@/ui/screens/Welcome';

const NAV: ReadonlyArray<{ path: AppPath; label: string }> = [
  { path: '/', label: 'Welcome' },
  { path: '/load', label: 'Load a rulebook' },
  { path: '/exam', label: 'Exam Day' },
  { path: '/ask', label: 'Ask' },
];

function Screen({ path }: { path: AppPath }) {
  if (path === '/dev') return <DevPage />;
  if (path === '/load') return <LoadRulebook />;
  if (path === '/cartridge') return <CartridgeView />;
  if (path === '/ask') return <Ask />;
  if (path === '/exam') return <ExamDay />;
  return <Welcome />;
}

export function App() {
  const path = usePath();
  const [egressOpen, setEgressOpen] = useState(false);
  const closeEgress = useCallback(() => setEgressOpen(false), []);
  const entries = useEgressLog();
  const cloudCalls = entries.filter((e) => e.kind === 'cloud-call').length;

  return (
    <MotionConfig reducedMotion="user">
      <div className="flex min-h-svh flex-col">
        <header className="flex flex-wrap items-center justify-between gap-3 border-b px-6 py-3">
          <div className="flex items-center gap-6">
            <a href="/" onClick={linkHandler('/')} className="font-semibold tracking-tight">
              Cartridge
            </a>
            <nav aria-label="Main">
              <ul className="flex gap-1">
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
          <Button
            variant="outline"
            size="sm"
            onClick={() => setEgressOpen(true)}
            aria-haspopup="dialog"
          >
            What left this device ({cloudCalls})
          </Button>
        </header>
        <main className="flex-1 px-6">
          <Screen path={path} />
        </main>
        <footer className="border-t px-6 py-3 text-xs text-muted-foreground">
          Reference tool, not an official authority.
        </footer>
      </div>
      <EgressPanel open={egressOpen} onClose={closeEgress} />
    </MotionConfig>
  );
}
