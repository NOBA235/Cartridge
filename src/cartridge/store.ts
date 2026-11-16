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
  sourceId: string;
  currentVersion: number;
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

export const telemetryStore = {
  async put(entry: EgressEntry): Promise<void> {
    await (await db()).put('telemetry', entry);
  },
  async all(): Promise<EgressEntry[]> {
    return (await db()).getAll('telemetry');
  },
};
