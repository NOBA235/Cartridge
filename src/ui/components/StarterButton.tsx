/**
 * One-click loader for the bundled, real-compiled OWASP ASVS 5.0 starter
 * standard (74 rules, CC BY-SA 4.0). Loads offline from /starter/ into
 * IndexedDB, verifies the SHA-256 hash and every quote locally, and activates
 * the cartridge. No cloud call is made.
 */
import { useState } from 'react';
import { loadStarterCartridge, STARTER_STANDARD, type StarterResult } from '@/cartridge/starter';
import { Button } from '@/ui/primitives/button';

export function StarterButton({
  size = 'default',
  variant = 'default',
  label = `Load ${STARTER_STANDARD.shortName} starter (${STARTER_STANDARD.ruleCount} rules)`,
  onLoaded,
}: {
  size?: 'default' | 'sm';
  variant?: 'default' | 'outline' | 'secondary';
  label?: string;
  onLoaded?: (result: StarterResult) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await loadStarterCartridge();
      onLoaded?.(res);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-1.5">
      <Button
        size={size}
        variant={variant}
        disabled={busy}
        className="self-start"
        onClick={() => void load()}
      >
        {busy ? 'Loading starter standard…' : label}
      </Button>
      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
