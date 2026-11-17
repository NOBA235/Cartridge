import { describe, expect, it } from 'vitest';
import { isQuotaError, storageErrorMessage } from './storageErrors';

const quota = () =>
  Object.assign(new Error('The quota has been exceeded.'), { name: 'QuotaExceededError' });

describe('storage errors', () => {
  it('recognises a quota error, also inside an aborted transaction', () => {
    expect(isQuotaError(quota())).toBe(true);
    expect(isQuotaError({ name: 'AbortError', error: quota() })).toBe(true);
    expect(isQuotaError({ name: 'UnknownError', code: 22 })).toBe(true);
    expect(isQuotaError(new Error('Network'))).toBe(false);
    expect(isQuotaError(undefined)).toBe(false);
  });

  it('says what to do when the device is full', () => {
    expect(storageErrorMessage(quota(), 'the rulebook')).toBe(
      'There is not enough storage space on this device to save the rulebook. Delete rulebooks or cartridges you no longer need, or free space on the device, then try again.',
    );
  });

  it('explains blocked storage and passes other errors through', () => {
    expect(storageErrorMessage(new Error('IndexedDB is not available.'), 'the cartridge')).toMatch(
      /^This browser does not allow saving data here/,
    );
    expect(storageErrorMessage(new Error('Boom'), 'the cartridge')).toBe(
      'The cartridge could not be saved: Boom',
    );
  });
});
