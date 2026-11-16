import { describe, expect, it } from 'vitest';
import type { EgressEntry } from './egress';
import { counterFor, questionBytes } from './receipt';

describe('receipt', () => {
  it('counts each answer once, by where it came from', () => {
    expect(counterFor({ route: 'ON_DEVICE', status: 'verified' })).toBe('onDevice');
    expect(counterFor({ route: 'IN_CLOUD', status: 'verified' })).toBe('cloud');
    expect(counterFor({ route: 'IN_CLOUD', status: 'escalated' })).toBe('cloud');
    expect(counterFor({ route: 'QUEUED', status: 'queued' })).toBe('queued');
    expect(counterFor({ route: 'ON_DEVICE', status: 'unanswered' })).toBe('unanswered');
  });

  it('adds up bytes sent for questions only', () => {
    const e = (label: string, bytesSent: number, kind: EgressEntry['kind'] = 'cloud-call') =>
      ({
        id: 1,
        at: '',
        kind,
        label,
        bytesSent,
        preview: '',
        origins: [],
        status: 'ok',
      }) as EgressEntry;
    expect(
      questionBytes([
        e('ANSWER', 100),
        e('ANSWER', 50),
        e('COMPILE', 9000),
        e('Signal check', 0, 'probe'),
      ]),
    ).toBe(150);
  });
});
