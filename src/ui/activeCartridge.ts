/**
 * The cartridge every screen works with unless a link names another (see
 * src/cartridge/active.ts), and the words on its label.
 */
import { useEffect, useSyncExternalStore } from 'react';
import { activeCartridge, resolveActiveId } from '@/cartridge/active';
import type { CartridgeRecord } from '@/cartridge/store';
import type { Cartridge } from '@/cartridge/types';

export { activeCartridge, resolveActiveId };

/**
 * The cartridge a screen should show: the one named in the link (which then
 * becomes the active one), else the active one.
 */
export function useChosenCartridgeId(
  records: readonly CartridgeRecord[] | null,
  fromLink: string | null,
): string | null {
  const explicit = useSyncExternalStore(activeCartridge.subscribe, activeCartridge.get);
  useEffect(() => {
    if (fromLink) activeCartridge.set(fromLink);
  }, [fromLink]);
  if (fromLink) return fromLink;
  return records ? resolveActiveId(explicit, records) : null;
}

const EXTENSION = /\.(pdf|txt|md|markdown)$/i;

/** The words on the cartridge's label, for example 'Field standards, 9 rules, passed 10 of 12'. */
export function cartridgeLabel(c: Pick<Cartridge, 'name' | 'rules' | 'report'>): {
  title: string;
  rules: string;
  tested: string;
  full: string;
} {
  const title = c.name.replace(EXTENSION, '').trim() || c.name;
  const n = c.rules.length;
  const rules = `${n} rule${n === 1 ? '' : 's'}`;
  const r = c.report;
  const tested = !r
    ? 'not tested yet'
    : r.measuredOn !== 'device'
      ? 'not measured on a real device'
      : r.counts
        ? `passed ${r.counts.heldOut.passed} of ${r.counts.heldOut.total}`
        : `test pass rate ${Math.round(r.heldOutPassRate * 100)}%`;
  return { title, rules, tested, full: `${title}, ${rules}, ${tested}` };
}
