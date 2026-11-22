/**
 * Firestore Public Cartridge Library + Firebase Auth.
 *
 * Privacy boundary (enforced by types and at run time):
 * - ONLY openly licensed, user-confirmed PUBLIC standards and their compiled
 *   cartridges may ever be published to Firestore.
 * - Private user questions, architecture diagrams, notes and egress logs NEVER
 *   touch Firestore — they remain strictly local in IndexedDB.
 * - Every published payload passes through Public<T> + assertPublic() and is
 *   logged to 'What left this device' (egressLog).
 * - Every cartridge installed from Firestore has its SHA-256 source hash and
 *   every single rule quote re-verified locally on this device before saving.
 */
import {
  getAuth,
  GoogleAuthProvider,
  onAuthStateChanged,
  signInAnonymously,
  signInWithPopup,
  signOut,
  type Auth,
  type User,
} from 'firebase/auth';
import {
  collection,
  doc,
  getDocs,
  getFirestore,
  initializeFirestore,
  limit,
  orderBy,
  persistentLocalCache,
  persistentMultipleTabManager,
  query,
  setDoc,
  type Firestore,
} from 'firebase/firestore';
import { z } from 'zod';
import { getFirebase } from '@/ai/firebase';
import { activeCartridge } from '@/cartridge/active';
import { buildDraftFromText, confirmSource, type SourceDoc } from '@/cartridge/source';
import { cartridgesStore, sourcesStore } from '@/cartridge/store';
import { CartridgeSchema, type Cartridge } from '@/cartridge/types';
import { prepareSource, verifyQuote } from '@/cartridge/verifyQuote';
import { requestPersistentStorage, storageErrorMessage } from '@/lib/storageErrors';
import { createStore } from '@/lib/store';
import { asPublic, assertPublic, type Public } from '@/privacy';
import { egressLog, utf8Bytes } from '@/telemetry/egress';

export const PUBLIC_COLLECTION = 'public_cartridges';
/** Keep published source text well below Firestore's 1 MiB document ceiling. */
export const MAX_PUBLIC_SOURCE_CHARS = 400_000;

export const PublicCartridgeDocSchema = z.object({
  id: z.string().min(1).max(120),
  name: z.string().trim().min(1).max(200),
  licence: z.string().trim().min(1).max(200),
  sourceHash: z.string().min(8).max(128),
  sourceText: z.string().min(1).max(MAX_PUBLIC_SOURCE_CHARS),
  cartridge: CartridgeSchema,
  ruleCount: z.number().int().positive(),
  criticalCount: z.number().int().nonnegative(),
  publishedByUid: z.string().min(1).max(128),
  publishedByName: z.string().trim().min(1).max(120),
  publishedAt: z.string().min(1),
});
export type PublicCartridgeDoc = z.infer<typeof PublicCartridgeDocSchema>;

export interface AuthSnapshot {
  readonly ready: boolean;
  readonly user: {
    readonly uid: string;
    readonly label: string;
    readonly isAnonymous: boolean;
  } | null;
}

const authStore = createStore<AuthSnapshot>({ ready: false, user: null });
let authInstance: Auth | undefined;
let firestoreInstance: Firestore | undefined;
let authListenerStarted = false;

function toUserSummary(u: User | null): AuthSnapshot['user'] {
  if (!u) return null;
  return {
    uid: u.uid,
    label: u.displayName || u.email || (u.isAnonymous ? 'Guest publisher' : 'Signed-in user'),
    isAnonymous: u.isAnonymous,
  };
}

function requireAuth(): Auth {
  if (authInstance) return authInstance;
  const fb = getFirebase();
  if (!fb.ok) throw new Error(fb.reason);
  authInstance = getAuth(fb.app);
  return authInstance;
}

function requireFirestore(): Firestore {
  if (firestoreInstance) return firestoreInstance;
  const fb = getFirebase();
  if (!fb.ok) throw new Error(fb.reason);
  try {
    firestoreInstance = initializeFirestore(fb.app, {
      localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
    });
  } catch {
    firestoreInstance = getFirestore(fb.app);
  }
  return firestoreInstance;
}

export const libraryAuth = {
  subscribe: authStore.subscribe,
  get: authStore.get,
  init(): void {
    if (authListenerStarted || typeof window === 'undefined') return;
    const fb = getFirebase();
    if (!fb.ok) {
      authStore.set({ ready: true, user: null });
      return;
    }
    authListenerStarted = true;
    try {
      const auth = requireAuth();
      onAuthStateChanged(auth, (u) => {
        authStore.set({ ready: true, user: toUserSummary(u) });
      });
    } catch {
      authStore.set({ ready: true, user: null });
    }
  },
  async signInGoogle(): Promise<void> {
    const auth = requireAuth();
    await signInWithPopup(auth, new GoogleAuthProvider());
  },
  async signInGuest(): Promise<void> {
    const auth = requireAuth();
    await signInAnonymously(auth);
  },
  async signOut(): Promise<void> {
    const auth = requireAuth();
    await signOut(auth);
  },
};

/** Pure builder + privacy/quote verifier for a public Firestore cartridge document. */
export function buildPublicCartridgeDoc(input: {
  cartridge: Cartridge;
  source: SourceDoc;
  publisher: { uid: string; label: string };
  now?: Date;
}): Public<PublicCartridgeDoc> {
  const { cartridge, source, publisher } = input;
  if ((source as { publicConfirmed?: unknown }).publicConfirmed !== true) {
    throw new Error('Only a confirmed public standard may be published to the Public Library.');
  }
  if (!source.licence.trim()) {
    throw new Error('A public licence is required before publishing.');
  }
  if (cartridge.sourceHash !== source.hash) {
    throw new Error('This cartridge does not match the saved rulebook hash on this device.');
  }
  if (source.text.length > MAX_PUBLIC_SOURCE_CHARS) {
    throw new Error(
      `This standard is ${source.text.length.toLocaleString()} characters; Firestore library documents accept up to ${MAX_PUBLIC_SOURCE_CHARS.toLocaleString()} characters.`,
    );
  }
  const prepared = prepareSource(source);
  for (const r of cartridge.rules) {
    if (!verifyQuote(r.source.quote, prepared).ok) {
      throw new Error(`Rule ${r.id} failed local quote verification and cannot be published.`);
    }
  }
  const docId = `${source.hash.slice(0, 16)}-v${cartridge.version}`;
  const parsed = PublicCartridgeDocSchema.parse({
    id: docId,
    name: cartridge.name,
    licence: source.licence,
    sourceHash: source.hash,
    sourceText: source.text,
    cartridge: {
      ...cartridge,
      sourceName: source.name,
      sourceLicence: source.licence,
    },
    ruleCount: cartridge.rules.length,
    criticalCount: cartridge.rules.filter((r) => r.severity === 'critical').length,
    publishedByUid: publisher.uid,
    publishedByName: publisher.label,
    publishedAt: (input.now ?? new Date()).toISOString(),
  });
  return asPublic(parsed, 'cartridge');
}

/** Publishes a confirmed public cartridge + standard excerpt to Firestore and logs egress. */
export async function publishPublicCartridge(
  cartridge: Cartridge,
  source: SourceDoc,
): Promise<PublicCartridgeDoc> {
  const user = authStore.get().user;
  if (!user) throw new Error('Sign in first to publish to the Public Cartridge Library.');
  const wrapped = buildPublicCartridgeDoc({ cartridge, source, publisher: user });
  assertPublic(wrapped, 'publishPublicCartridge');
  const payload = wrapped.value;
  const serialized = JSON.stringify(payload);
  const bytes = utf8Bytes(serialized);

  const db = requireFirestore();
  try {
    await setDoc(doc(db, PUBLIC_COLLECTION, payload.id), payload);
    egressLog.record({
      kind: 'cloud-call',
      label: 'PUBLISH_PUBLIC_CARTRIDGE',
      bytesSent: bytes,
      text: `${payload.name} (${payload.ruleCount} rules, ${payload.licence})`,
      origins: ['source-document', 'cartridge'],
      status: 'ok',
    });
    return payload;
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    egressLog.record({
      kind: 'cloud-call',
      label: 'PUBLISH_PUBLIC_CARTRIDGE',
      bytesSent: bytes,
      text: `${payload.name} (${payload.ruleCount} rules, ${payload.licence})`,
      origins: ['source-document', 'cartridge'],
      status: 'error',
      error: message,
    });
    throw e;
  }
}

/** Lists published public cartridges from Firestore (uses persistent offline cache when offline). */
export async function listPublicCartridges(maxItems = 20): Promise<PublicCartridgeDoc[]> {
  const db = requireFirestore();
  const snap = await getDocs(
    query(collection(db, PUBLIC_COLLECTION), orderBy('publishedAt', 'desc'), limit(maxItems)),
  );
  const items: PublicCartridgeDoc[] = [];
  for (const d of snap.docs) {
    const parsed = PublicCartridgeDocSchema.safeParse(d.data());
    if (parsed.success) items.push(parsed.data);
  }
  return items;
}

export interface InstallLibraryDeps {
  sources?: Pick<typeof sourcesStore, 'list' | 'put'>;
  cartridges?: Pick<typeof cartridgesStore, 'list' | 'saveVersion'>;
  setActive?: (id: string) => void;
  persistStorage?: () => Promise<boolean>;
}

/**
 * Installs a cartridge from the Firestore Public Library into local IndexedDB,
 * re-verifying the SHA-256 source hash and every rule's quote locally first.
 */
export async function installPublicCartridge(
  entry: PublicCartridgeDoc,
  deps: InstallLibraryDeps = {},
): Promise<{ cartridgeId: string; alreadyInstalled: boolean }> {
  const sources = deps.sources ?? sourcesStore;
  const cartridges = deps.cartridges ?? cartridgesStore;
  const setActive = deps.setActive ?? ((id: string) => activeCartridge.set(id));
  const persistStorage = deps.persistStorage ?? requestPersistentStorage;

  const draft = await buildDraftFromText(entry.name, entry.sourceText, 'markdown');
  if (draft.hash !== entry.sourceHash || entry.cartridge.sourceHash !== draft.hash) {
    throw new Error('This library cartridge failed local SHA-256 hash verification.');
  }
  const source = confirmSource(draft, entry.licence);
  const prepared = prepareSource(source);
  for (const r of entry.cartridge.rules) {
    if (!verifyQuote(r.source.quote, prepared).ok) {
      throw new Error(`Library rule ${r.id} failed local quote verification.`);
    }
  }

  const existingSources = await sources.list();
  const matchedSource = existingSources.find((s) => s.hash === source.hash);
  const savedSource = matchedSource ?? source;
  if (!matchedSource) {
    try {
      await sources.put(source);
    } catch (e) {
      throw new Error(storageErrorMessage(e, 'the library standard'), { cause: e });
    }
  }

  const existingCartridges = await cartridges.list();
  const existing = existingCartridges.find(
    (c) => c.sourceHash === entry.sourceHash && c.currentVersion === entry.cartridge.version,
  );
  if (existing) {
    setActive(existing.id);
    return { cartridgeId: existing.id, alreadyInstalled: true };
  }

  const localCopy: Cartridge = {
    ...entry.cartridge,
    id: `ctg-${crypto.randomUUID()}`,
    changelog: [
      ...entry.cartridge.changelog,
      `Installed from Public Cartridge Library (published by ${entry.publishedByName}).`,
    ],
  };
  try {
    await cartridges.saveVersion(localCopy, savedSource.id);
  } catch (e) {
    throw new Error(storageErrorMessage(e, 'the library cartridge'), { cause: e });
  }
  void persistStorage();
  setActive(localCopy.id);
  return { cartridgeId: localCopy.id, alreadyInstalled: false };
}
