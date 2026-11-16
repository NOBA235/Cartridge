/**
 * IndexedDB storage (idb). Stores: sources, cartridges, versions, queue, telemetry.
 * Everything stays on this device.
 *
 * - sources: loaded rulebooks, keyed by id (derived from the SHA-256 hash).
 * - cartridges: one record per cartridge: name, source and current version.
 * - versions: every version of every cartridge, keyed by [id, version].
 * - queue: questions waiting for signal (shape completed in Phase 3).
 * - telemetry: the egress log ('What left this device'), keyed by entry id.
 */
import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { EgressEntry } from '@/telemetry/egress';
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

/** Minimal for now; Phase 3 adds the question and routing fields. */
export interface QueueRecord {
  id: string;
  createdAt: string;
  [key: string]: unknown;
}

export interface CartridgeDB extends DBSchema {
  sources: { key: string; value: SourceDoc; indexes: { 'by-created': string } };
  cartridges: { key: string; value: CartridgeRecord; indexes: { 'by-source': string } };
  versions: { key: [string, number]; value: Cartridge; indexes: { 'by-cartridge': string } };
  queue: { key: string; value: QueueRecord; indexes: { 'by-created': string } };
  telemetry: { key: number; value: EgressEntry };
}

export const DB_NAME = 'cartridge';
export const DB_VERSION = 1;

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
    },
  });
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
    return record;
  },
  /** Newest first. */
  async list(): Promise<CartridgeRecord[]> {
    const all = await (await db()).getAll('cartridges');
    return all.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
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
  /** Deletes the cartridge and all its versions. */
  async delete(id: string): Promise<void> {
    const d = await db();
    const tx = d.transaction(['cartridges', 'versions'], 'readwrite');
    const keys = await tx.objectStore('versions').index('by-cartridge').getAllKeys(id);
    await Promise.all([
      ...keys.map((k) => tx.objectStore('versions').delete(k)),
      tx.objectStore('cartridges').delete(id),
      tx.done,
    ]);
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
