import { describe, expect, it, vi } from 'vitest';
import starterMd from '../../public/starter/owasp-asvs-5.0-architecture.md?raw';
import starterJson from '../../public/starter/owasp-asvs-5.0.cartridge.json?raw';
import { loadStarterCartridge, STARTER_STANDARD } from './starter';
import type { SourceDoc } from './source';
import type { CartridgeRecord } from './store';
import type { Cartridge } from './types';

function readFromPublic(url: string): Promise<string> {
  if (url === STARTER_STANDARD.sourceUrl) return Promise.resolve(starterMd);
  if (url === STARTER_STANDARD.cartridgeUrl) return Promise.resolve(starterJson);
  return Promise.reject(new Error(`Unexpected URL: ${url}`));
}

function memoryStores() {
  const sources: SourceDoc[] = [];
  const cartridges: Cartridge[] = [];
  const records: CartridgeRecord[] = [];
  return {
    sources,
    cartridges,
    deps: {
      fetchText: readFromPublic,
      sources: {
        list: async () => [...sources],
        put: async (s: SourceDoc) => {
          sources.push(s);
        },
      },
      cartridges: {
        list: async () => [...records],
        saveVersion: async (c: Cartridge, sourceId: string) => {
          cartridges.push(c);
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
      setActive: vi.fn(),
      persistStorage: async () => true,
    },
  };
}

describe('bundled OWASP ASVS 5.0 starter standard', () => {
  it('loads the real bundled files, verifies source hash and all 74 quotes, and is idempotent', async () => {
    const m = memoryStores();
    const first = await loadStarterCartridge(m.deps);
    expect(first.alreadyLoaded).toBe(false);
    expect(first.ruleCount).toBe(STARTER_STANDARD.ruleCount);
    expect(m.sources).toHaveLength(1);
    expect(m.cartridges).toHaveLength(1);
    expect(m.cartridges[0]?.rules.some((r) => r.severity === 'critical')).toBe(true);
    expect(m.cartridges[0]?.rules.some((r) => r.exceptions.length > 0)).toBe(true);
    expect(m.deps.setActive).toHaveBeenCalledWith(first.cartridgeId);

    const second = await loadStarterCartridge(m.deps);
    expect(second).toEqual({
      cartridgeId: first.cartridgeId,
      ruleCount: first.ruleCount,
      alreadyLoaded: true,
    });
    expect(m.sources).toHaveLength(1);
    expect(m.cartridges).toHaveLength(1);
  });

  it('refuses a mismatched source hash', async () => {
    const m = memoryStores();
    await expect(
      loadStarterCartridge({
        ...m.deps,
        fetchText: async (url) =>
          url === STARTER_STANDARD.sourceUrl ? 'tampered text' : readFromPublic(url),
      }),
    ).rejects.toThrow(/does not match/);
  });
});
