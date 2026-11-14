import { describe, expect, it } from 'vitest';
import { escalate, firstRoute, type EscalationReason } from './router';

const REASONS: EscalationReason[] = [
  'NO_MATCH',
  'LOW_RETRIEVAL',
  'VALIDATION_FAILED',
  'DEVICE_ERROR',
  'DEVICE_UNAVAILABLE',
  'USER_REQUESTED',
];

describe('router', () => {
  it('goes to the device first when it is ready', () => {
    expect(firstRoute(true, { online: true, cloudAllowed: true })).toEqual({ route: 'device' });
  });

  it('escalates with DEVICE_UNAVAILABLE when the device is not ready', () => {
    expect(firstRoute(false, { online: true, cloudAllowed: true })).toEqual({
      route: 'cloud',
      reason: 'DEVICE_UNAVAILABLE',
    });
  });

  it.each(REASONS)('%s: cloud when online and allowed', (reason) => {
    expect(escalate(reason, { online: true, cloudAllowed: true })).toEqual({
      route: 'cloud',
      reason,
    });
  });

  it.each(REASONS)('%s: queue when offline and allowed', (reason) => {
    expect(escalate(reason, { online: false, cloudAllowed: true })).toEqual({
      route: 'queue',
      reason,
    });
  });

  it.each(REASONS)('%s: stays on this device when the cloud setting is off', (reason) => {
    expect(escalate(reason, { online: true, cloudAllowed: false })).toEqual({
      route: 'local-only',
      reason,
    });
    expect(escalate(reason, { online: false, cloudAllowed: false })).toEqual({
      route: 'local-only',
      reason,
    });
  });
});
