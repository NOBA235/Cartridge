/**
 * Pre-compiled, openly licensed starter standard bundled in /starter/.
 *
 * Loading it saves the real OWASP ASVS 5.0 excerpt and its compiled cartridge
 * into local IndexedDB, verifying the SHA-256 source hash and every rule quote
 * on this device. No cloud call is made. Idempotent: loading twice reuses the
 * existing copy and selects it as the active cartridge.
 */
import { requestPersistentStorage, storageErrorMessage } from '@/lib/storageErrors';
import { activeCartridge } from './active';
import { importCartridgeJson } from './cartridgeIO';
import { buildDraftFromText, confirmSource, type SourceDoc } from './source';
import { cartridgesStore, sourcesStore, type CartridgeRecord } from './store';
import type { Cartridge } from './types';
import { prepareSource, verifyQuote } from './verifyQuote';

export const STARTER_STANDARD = {
  name: 'OWASP ASVS 5.0 — Architecture & Runtime',
  shortName: 'OWASP ASVS 5.0',
  chapters: 'V7 Sessions, V8 Authorization, V12 TLS, V14 Data Protection, V16 Logging',
  licence: 'CC BY-SA 4.0',
  ruleCount: 74,
  sourceUrl: '/starter/owasp-asvs-5.0-architecture.md',
  cartridgeUrl: '/starter/owasp-asvs-5.0.cartridge.json',
  sampleQuestions: [
    'What is the minimum entropy for session reference tokens?',
    'Is TLS required for internal HTTP services?',
    'Can I store sensitive user data in browser localStorage?',
  ] as const,
} as const;

export interface StarterDeps {
  fetchText?: (url: string) => Promise<string>;
  sources?: Pick<typeof sourcesStore, 'list' | 'put'>;
  cartridges?: Pick<typeof cartridgesStore, 'list' | 'saveVersion'>;
  setActive?: (id: string) => void;
  persistStorage?: () => Promise<boolean>;
}

export interface StarterResult {
  cartridgeId: string;
  ruleCount: number;
  alreadyLoaded: boolean;
}

async function defaultFetchText(url: string): Promise<string> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Could not load ${url} (HTTP ${res.status}).`);
  return res.text();
}

export async function loadStarterCartridge(deps: StarterDeps = {}): Promise<StarterResult> {
  const fetchText = deps.fetchText ?? defaultFetchText;
  const sources = deps.sources ?? sourcesStore;
  const cartridges = deps.cartridges ?? cartridgesStore;
  const setActive = deps.setActive ?? ((id: string) => activeCartridge.set(id));
  const persistStorage = deps.persistStorage ?? requestPersistentStorage;

  const [sourceText, cartridgeJson] = await Promise.all([
    fetchText(STARTER_STANDARD.sourceUrl),
    fetchText(STARTER_STANDARD.cartridgeUrl),
  ]);

  const draft = await buildDraftFromText(STARTER_STANDARD.name, sourceText, 'markdown');
  const source: SourceDoc = confirmSource(draft, STARTER_STANDARD.licence);
  const imported = importCartridgeJson(cartridgeJson);
  const cartridge: Cartridge = {
    ...imported,
    name: STARTER_STANDARD.name,
    sourceName: STARTER_STANDARD.name,
    sourceLicence: STARTER_STANDARD.licence,
  };

  if (cartridge.sourceHash !== source.hash) {
    throw new Error('The starter cartridge does not match its bundled standard.');
  }
  const prepared = prepareSource(source);
  for (const r of cartridge.rules) {
    if (!verifyQuote(r.source.quote, prepared).ok) {
      throw new Error(`Starter rule ${r.id} failed local quote verification.`);
    }
  }

  const existingSources = await sources.list();
  const matchedSource = existingSources.find((s) => s.hash === source.hash);
  const savedSource = matchedSource ?? source;
  if (!matchedSource) {
    try {
      await sources.put(source);
    } catch (e) {
      throw new Error(storageErrorMessage(e, 'the starter standard'), { cause: e });
    }
  }

  const existingCartridges: CartridgeRecord[] = await cartridges.list();
  const existing = existingCartridges.find((c) => c.sourceHash === cartridge.sourceHash);
  if (existing) {
    setActive(existing.id);
    return { cartridgeId: existing.id, ruleCount: existing.ruleCount, alreadyLoaded: true };
  }

  try {
    await cartridges.saveVersion(cartridge, savedSource.id);
  } catch (e) {
    throw new Error(storageErrorMessage(e, 'the starter cartridge'), { cause: e });
  }
  void persistStorage();
  setActive(cartridge.id);
  return { cartridgeId: cartridge.id, ruleCount: cartridge.rules.length, alreadyLoaded: false };
}
