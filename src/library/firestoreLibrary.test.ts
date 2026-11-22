import { describe, expect, it, vi } from 'vitest';
import { buildDraftFromText, confirmSource, type SourceDoc } from '@/cartridge/source';
import type { CartridgeRecord } from '@/cartridge/store';
import type { Cartridge } from '@/cartridge/types';
import { isPublic } from '@/privacy';
import { FIELD_CARTRIDGE, FIELD_SOURCE } from '@/testing/fieldFixture';
import {
  buildPublicCartridgeDoc,
  installPublicCartridge,
  type PublicCartridgeDoc,
} from './firestoreLibrary';

async function realPublicPair() {
  const draft = await buildDraftFromText('Field standards', FIELD_SOURCE.text, 'text');
  const source = confirmSource(draft, 'CC0 1.0');
  const cartridge: Cartridge = { ...FIELD_CARTRIDGE, sourceHash: source.hash };
  return { source, cartridge };
}

describe('Firestore Public Cartridge Library guards', () => {
  it('mints a validated Public document only when the source is confirmed public and all quotes verify', async () => {
    const { source, cartridge } = await realPublicPair();
    const wrapped = buildPublicCartridgeDoc({
      cartridge,
      source,
      publisher: { uid: 'u1', label: 'Alex' },
      now: new Date('2026-11-22T00:00:00Z'),
    });
    expect(isPublic(wrapped)).toBe(true);
    expect(wrapped.value.ruleCount).toBe(cartridge.rules.length);
    expect(wrapped.value.criticalCount).toBe(3);
    expect(wrapped.value.licence).toBe('CC0 1.0');
  });

  it('refuses unconfirmed sources and cartridges with tampered quotes', async () => {
    const { source, cartridge } = await realPublicPair();
    const unconfirmed = { ...source, publicConfirmed: false } as unknown as SourceDoc;
    expect(() =>
      buildPublicCartridgeDoc({
        cartridge,
        source: unconfirmed,
        publisher: { uid: 'u1', label: 'A' },
      }),
    ).toThrow(/confirmed public/);

    const badQuote: Cartridge = {
      ...cartridge,
      rules: cartridge.rules.map((r, i) =>
        i === 0 ? { ...r, source: { ...r.source, quote: 'Not in source text at all' } } : r,
      ),
    };
    expect(() =>
      buildPublicCartridgeDoc({
        cartridge: badQuote,
        source,
        publisher: { uid: 'u1', label: 'A' },
      }),
    ).toThrow(/failed local quote verification/);
  });

  it('re-verifies hash and quotes on install and refuses tampered remote entries', async () => {
    const { source, cartridge } = await realPublicPair();
    const entry: PublicCartridgeDoc = buildPublicCartridgeDoc({
      cartridge,
      source,
      publisher: { uid: 'u1', label: 'Alex' },
    }).value;

    const sources: SourceDoc[] = [];
    const records: CartridgeRecord[] = [];
    const setActive = vi.fn();
    const deps = {
      sources: {
        list: async () => [...sources],
        put: async (s: SourceDoc) => {
          sources.push(s);
        },
      },
      cartridges: {
        list: async () => [...records],
        saveVersion: async (c: Cartridge, sourceId: string) => {
          const rec: CartridgeRecord = {
            id: c.id,
            name: c.name,
            sourceId,
            sourceHash: c.sourceHash,
            currentVersion: c.version,
            ruleCount: c.rules.length,
            updatedAt: c.createdAt,
          };
          records.push(rec);
          return rec;
        },
      },
      setActive,
      persistStorage: async () => true,
    };

    const first = await installPublicCartridge(entry, deps);
    expect(first.alreadyInstalled).toBe(false);
    expect(sources).toHaveLength(1);
    expect(records).toHaveLength(1);
    expect(setActive).toHaveBeenCalledWith(first.cartridgeId);

    const second = await installPublicCartridge(entry, deps);
    expect(second).toEqual({ cartridgeId: first.cartridgeId, alreadyInstalled: true });

    await expect(
      installPublicCartridge({ ...entry, sourceText: 'tampered text' }, deps),
    ).rejects.toThrow(/SHA-256 hash/);
  });
});
