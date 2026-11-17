/**
 * Plain messages for storage failures (IndexedDB and localStorage), and a
 * request to keep this site's data when the browser clears space.
 */

/** True for a full disk or a storage quota: QuotaExceededError, also when it aborted a transaction. */
export function isQuotaError(e: unknown): boolean {
  const seen = new Set<unknown>();
  let cur: unknown = e;
  while (cur && typeof cur === 'object' && !seen.has(cur)) {
    seen.add(cur);
    const name = (cur as { name?: unknown }).name;
    if (name === 'QuotaExceededError') return true;
    // idb rejects tx.done with the transaction's error; DOMException code 22 is the legacy quota code.
    if ((cur as { code?: unknown }).code === 22) return true;
    cur = (cur as { error?: unknown; cause?: unknown }).error ?? (cur as { cause?: unknown }).cause;
  }
  return false;
}

/** What to tell the user when `what` (for example 'the rulebook') could not be saved. */
export function storageErrorMessage(e: unknown, what: string): string {
  if (isQuotaError(e)) {
    return `There is not enough storage space on this device to save ${what}. Delete rulebooks or cartridges you no longer need, or free space on the device, then try again.`;
  }
  const message = e instanceof Error ? e.message : String(e);
  if (/IndexedDB is not available/i.test(message)) {
    return `This browser does not allow saving data here (private browsing can block it), so ${what} cannot be saved.`;
  }
  return `${what.charAt(0).toUpperCase()}${what.slice(1)} could not be saved: ${message}`;
}

/**
 * Asks the browser to keep this site's data when it clears space (the
 * rulebooks and cartridges are the whole point offline). Best effort: the
 * browser decides, and older browsers have no such API.
 */
export async function requestPersistentStorage(): Promise<boolean> {
  try {
    const storage = globalThis.navigator?.storage;
    if (!storage?.persist) return false;
    if (await storage.persisted?.()) return true;
    return await storage.persist();
  } catch {
    return false;
  }
}
