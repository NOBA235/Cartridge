import { describe, expect, it } from 'vitest';
import type { EgressEntry } from './egress';
import { formatBytes, summariseEgress } from './summary';

let nextId = 1;
const e = (label: string, bytesSent: number, kind: EgressEntry['kind'] = 'cloud-call') =>
  ({
    id: nextId++,
    at: '',
    kind,
    label,
    bytesSent,
    preview: '',
    origins: [],
    status: 'ok',
  }) as EgressEntry;

describe('summariseEgress', () => {
  it('groups requests by purpose, counting retries, in a fixed order', () => {
    const s = summariseEgress([
      e('ANSWER', 120),
      e('COMPILE', 9000),
      e('REPAIR_QUOTE', 500),
      e('EXAM', 3000),
      e('COMPILE', 8000),
      e('TUTOR', 700),
      e('EDGE_BENCH', 900),
      e('Signal check', 0, 'probe'),
      e('PING', 40),
    ]);
    expect(s.rows.map((r) => [r.purpose, r.requests, r.bytes])).toEqual([
      ['making', 3, 17500],
      ['exam-questions', 1, 3000],
      ['tutor', 1, 700],
      ['connection-tests', 1, 900],
      ['questions', 1, 120],
      ['signal-checks', 1, 0],
      ['developer', 1, 40],
    ]);
    expect(s.totalRequests).toBe(9);
    expect(s.totalBytes).toBe(17500 + 3000 + 700 + 900 + 120 + 40);
  });

  it('counts approvals separately, sending nothing', () => {
    const s = summariseEgress([e('ask', 0, 'declassify'), e('ask', 0, 'declassify')]);
    expect(s.approvals).toBe(2);
    expect(s.rows).toEqual([]);
    expect(s.totalRequests).toBe(0);
  });

  it('shows a device call that reported the cloud', () => {
    const s = summariseEgress([e('ANSWER_ON_DEVICE', 300, 'unexpected-cloud')]);
    expect(s.rows).toEqual([
      expect.objectContaining({ purpose: 'unexpected', requests: 1, bytes: 300 }),
    ]);
  });

  it('is empty when nothing left this device', () => {
    expect(summariseEgress([])).toEqual({
      rows: [],
      totalBytes: 0,
      totalRequests: 0,
      approvals: 0,
    });
  });
});

describe('formatBytes', () => {
  it('uses bytes, KB and MB', () => {
    expect(formatBytes(0)).toBe('0 bytes');
    expect(formatBytes(1)).toBe('1 byte');
    expect(formatBytes(1023)).toBe('1023 bytes');
    expect(formatBytes(1536)).toBe('1.5 KB');
    expect(formatBytes(3 * 1024 * 1024)).toBe('3.00 MB');
  });
});
