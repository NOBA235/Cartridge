/**
 * IndexedDB storage (idb). Everything stays on this device.
 *
 * - sources: loaded rulebooks, keyed by id (derived from the SHA-256 hash).
 * - cartridges: one record per cartridge: name, source and current version.
 * - versions: every version of every cartridge, keyed by [id, version].
 * - queue: questions waiting for signal.
 * - telemetry: the egress log ('What left this device'), keyed by entry id.
 * - exams: the Exam Day questions per cartridge (practice and held-out), keyed by cartridge id.
 * - proposals: rules the cloud suggested, waiting for review or decided, keyed by id.
 */
import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import { ExamSetSchema, type ExamSet } from '@/exam/types';
import { createStore } from '@/lib/store';
import type { QueueItem, QueueStorage } from '@/queue/offlineQueue';
import type { EgressEntry } from '@/telemetry/egress';
import { ProposalRecordSchema, type ProposalRecord } from './proposals';
import type { SourceDoc } from './source';
import type { Cartridge } from './types';

export interface CartridgeRecord {
  id: string;
  name: string;
  /** Empty when the cartridge was imported and its rulebook is not on this device. */
  sourceId: string;
  sourceHash: string;
  currentVersion: number;
  ruleCount: number;
  updatedAt: string;
}

export interface CartridgeDB extends DBSchema {
  sources: { key: string; value: SourceDoc; indexes: { 'by-created': string } };
  cartridges: { key: string; value: CartridgeRecord; indexes: { 'by-source': string } };
  versions: { key: [string, number]; value: Cartridge; indexes: { 'by-cartridge': string } };
  queue: { key: string; value: QueueItem; indexes: { 'by-created': string } };
  telemetry: { key: number; value: EgressEntry };
  exams: { key: string; value: ExamSet };
  proposals: { key: string; value: ProposalRecord; indexes: { 'by-cartridge': string } };
}

export const DB_NAME = 'cartridge';
/** 1: sources, cartridges, versions, queue, telemetry. 2: adds 'exams'. 3: adds 'proposals'. */
export const DB_VERSION = 3;

export function openCartridgeDB(name = DB_NAME): Promise<IDBPDatabase<CartridgeDB>> {
  return openDB<CartridgeDB>(name, DB_VERSION, {
    upgrade(db, oldVersion) {
      if (oldVersion < 1) {
        db.createObjectStore('sources', { keyPath: 'id' }).createIndex('by-created', 'createdAt');
        db.createObjectStore('cartridges', { keyPath: 'id' }).createIndex('by-source', 'sourceId');
        db.createObjectStore('versions', { keyPath: ['id', 'version'] }).createIndex(
          'by-cartridge',
          'id',
        );
        db.createObjectStore('queue', { keyPath: 'id' }).createIndex('by-created', 'createdAt');
        db.createObjectStore('telemetry', { keyPath: 'id' });
      }
      if (oldVersion < 2) {
        db.createObjectStore('exams', { keyPath: 'cartridgeId' });
      }
      if (oldVersion < 3) {
        db.createObjectStore('proposals', { keyPath: 'id' }).createIndex(
          'by-cartridge',
          'cartridgeId',
        );
      }
    },
  });
}

/**
 * Bumped after every write to rulebooks or cartridges, so screens that show
 * them (header slot, Welcome, lists) refresh without polling.
 */
const changes = createStore(0);
export const dataChanges = { subscribe: changes.subscribe, get: changes.get };
function changed(): void {
  changes.set((n) => n + 1);
}

let dbPromise: Promise<IDBPDatabase<CartridgeDB>> | undefined;

/** Shared connection. Rejects where IndexedDB is unavailable (some private modes). */
export function db(): Promise<IDBPDatabase<CartridgeDB>> {
  if (typeof indexedDB === 'undefined')
    return Promise.reject(new Error('IndexedDB is not available.'));
  dbPromise ??= openCartridgeDB().catch((e: unknown) => {
    dbPromise = undefined;
    throw e;
  });
  return dbPromise;
}

export const sourcesStore = {
  async put(doc: SourceDoc): Promise<void> {
    await (await db()).put('sources', doc);
    changed();
  },
  async get(id: string): Promise<SourceDoc | undefined> {
    return (await db()).get('sources', id);
  },
  /** Newest first. */
  async list(): Promise<SourceDoc[]> {
    return (await (await db()).getAllFromIndex('sources', 'by-created')).reverse();
  },
  async delete(id: string): Promise<void> {
    await (await db()).delete('sources', id);
    changed();
  },
};

export function cartridgeRecord(c: Cartridge, sourceId: string, now = new Date()): CartridgeRecord {
  return {
    id: c.id,
    name: c.name,
    sourceId,
    sourceHash: c.sourceHash,
    currentVersion: c.version,
    ruleCount: c.rules.length,
    updatedAt: now.toISOString(),
  };
}

export const cartridgesStore = {
  /** Saves a version and makes it the current one, in one transaction. */
  async saveVersion(c: Cartridge, sourceId: string): Promise<CartridgeRecord> {
    const d = await db();
    const record = cartridgeRecord(c, sourceId);
    const tx = d.transaction(['cartridges', 'versions'], 'readwrite');
    await Promise.all([
      tx.objectStore('versions').put(c),
      tx.objectStore('cartridges').put(record),
      tx.done,
    ]);
    changed();
    return record;
  },
  /** Saves a version, makes it current, and records the decided suggestion, in one transaction. */
  async saveVersionWithProposal(c: Cartridge, sourceId: string, p: ProposalRecord): Promise<void> {
    const d = await db();
    const tx = d.transaction(['cartridges', 'versions', 'proposals'], 'readwrite');
    await Promise.all([
      tx.objectStore('versions').put(c),
      tx.objectStore('cartridges').put(cartridgeRecord(c, sourceId)),
      tx.objectStore('proposals').put(ProposalRecordSchema.parse(p)),
      tx.done,
    ]);
    changed();
  },
  /** Newest first. */
  async list(): Promise<CartridgeRecord[]> {
    const all = await (await db()).getAll('cartridges');
    return all.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  },
  async version(id: string, version: number): Promise<Cartridge | undefined> {
    return (await db()).get('versions', [id, version]);
  },
  /** Every version of a cartridge, oldest first. */
  async versions(id: string): Promise<Cartridge[]> {
    const all = await (await db()).getAllFromIndex('versions', 'by-cartridge', id);
    return all.sort((a, b) => a.version - b.version);
  },
  async current(
    id: string,
  ): Promise<{ record: CartridgeRecord; cartridge: Cartridge } | undefined> {
    const d = await db();
    const record = await d.get('cartridges', id);
    if (!record) return undefined;
    const cartridge = await d.get('versions', [id, record.currentVersion]);
    return cartridge ? { record, cartridge } : undefined;
  },
  /** Deletes the cartridge, all its versions, its saved exam and its suggestions. */
  async delete(id: string): Promise<void> {
    const d = await db();
    const tx = d.transaction(['cartridges', 'versions', 'exams', 'proposals'], 'readwrite');
    const [versionKeys, proposalKeys] = await Promise.all([
      tx.objectStore('versions').index('by-cartridge').getAllKeys(id),
      tx.objectStore('proposals').index('by-cartridge').getAllKeys(id),
    ]);
    await Promise.all([
      ...versionKeys.map((k) => tx.objectStore('versions').delete(k)),
      ...proposalKeys.map((k) => tx.objectStore('proposals').delete(k)),
      tx.objectStore('cartridges').delete(id),
      tx.objectStore('exams').delete(id),
      tx.done,
    ]);
    changed();
  },
};

/** Suggested rules. Records that fail validation are skipped, never shown. */
export const proposalsStore = {
  async put(p: ProposalRecord): Promise<void> {
    await (await db()).put('proposals', ProposalRecordSchema.parse(p));
    changed();
  },
  async get(id: string): Promise<ProposalRecord | undefined> {
    const parsed = ProposalRecordSchema.safeParse(await (await db()).get('proposals', id));
    return parsed.success ? parsed.data : undefined;
  },
  /** Newest first. */
  async list(cartridgeId: string): Promise<ProposalRecord[]> {
    const all = await (await db()).getAllFromIndex('proposals', 'by-cartridge', cartridgeId);
    return all
      .flatMap((raw) => {
        const p = ProposalRecordSchema.safeParse(raw);
        return p.success ? [p.data] : [];
      })
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  },
};

/** The saved exam per cartridge, so the same held-out questions are used on every run. */
export const examsStore = {
  async get(cartridgeId: string): Promise<ExamSet | undefined> {
    const raw = await (await db()).get('exams', cartridgeId);
    const parsed = ExamSetSchema.safeParse(raw);
    return parsed.success ? parsed.data : undefined;
  },
  async put(exam: ExamSet): Promise<void> {
    await (await db()).put('exams', exam);
  },
  async delete(cartridgeId: string): Promise<void> {
    await (await db()).delete('exams', cartridgeId);
  },
};

/** Questions waiting for signal. Stored on this device only. */
export const queueStore: QueueStorage = {
  async all() {
    return (await db()).getAllFromIndex('queue', 'by-created');
  },
  async put(item) {
    await (await db()).put('queue', item);
  },
  async delete(id) {
    await (await db()).delete('queue', id);
  },
};

export const telemetryStore = {
  async put(entry: EgressEntry): Promise<void> {
    await (await db()).put('telemetry', entry);
  },
  async all(): Promise<EgressEntry[]> {
    return (await db()).getAll('telemetry');
  },
};
