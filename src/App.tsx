import { MotionConfig } from 'motion/react';
import { useCallback, useState } from 'react';
import { EgressPanel } from '@/ui/components/EgressPanel';
import { useEgressLog } from '@/ui/hooks/useStores';
import { Button } from '@/ui/primitives/button';
import { DevPage } from '@/ui/screens/DevPage';
import { Welcome } from '@/ui/screens/Welcome';

function isDevRoute(): boolean {
  return window.location.pathname.replace(/\/+$/, '') === '/dev';
}

export function App() {
  const [egressOpen, setEgressOpen] = useState(false);
  const closeEgress = useCallback(() => setEgressOpen(false), []);
  const entries = useEgressLog();
  const cloudCalls = entries.filter((e) => e.kind === 'cloud-call').length;

  return (
    <MotionConfig reducedMotion="user">
      <div className="flex min-h-svh flex-col">
        <header className="flex items-center justify-between border-b px-6 py-3">
          <a href="/" className="font-semibold tracking-tight">
            Cartridge
          </a>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setEgressOpen(true)}
            aria-haspopup="dialog"
          >
            What left this device ({cloudCalls})
          </Button>
        </header>
        <div className="flex-1 px-6">{isDevRoute() ? <DevPage /> : <Welcome />}</div>
        <footer className="border-t px-6 py-3 text-xs text-muted-foreground">
          Reference tool, not an official authority.
        </footer>
      </div>
      <EgressPanel open={egressOpen} onClose={closeEgress} />
    </MotionConfig>
  );
}
