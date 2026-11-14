import { beforeEach, describe, expect, it } from 'vitest';
import { egressLog } from '@/telemetry/egress';
import {
  asPrivate,
  asPublic,
  assertPublic,
  declassify,
  fillTemplate,
  grantApproval,
  isPrivate,
  isPublic,
  PrivacyError,
  type Public,
} from './index';

beforeEach(() => egressLog._reset());

describe('Public and Private values', () => {
  it('mints values that are recognised at run time', () => {
    expect(isPublic(asPublic('rule text', 'cartridge'))).toBe(true);
    expect(isPrivate(asPrivate('my question', 'user-question'))).toBe(true);
  });

  it('keeps Public and Private apart', () => {
    expect(isPublic(asPrivate('x', 'user-note'))).toBe(false);
    expect(isPrivate(asPublic('x', 'app'))).toBe(false);
  });

  it('rejects a hand-built object that only looks Public', () => {
    const forged = Object.freeze({ value: 'secret', origins: ['app'] }) as unknown as Public<string>;
    expect(isPublic(forged)).toBe(false);
    expect(() => assertPublic(forged, 'test')).toThrow(PrivacyError);
  });

  it('rejects plain strings and Private values with distinct messages', () => {
    expect(() => assertPublic('plain', 'test')).toThrow(/unclassified/);
    expect(() => assertPublic(asPrivate('x', 'diagram-label'), 'test')).toThrow(/Private/);
  });

  it('freezes values so they cannot be edited after classification', () => {
    const p = asPublic('a', 'app');
    expect(Object.isFrozen(p)).toBe(true);
    expect(() => {
      (p as unknown as { value: string }).value = 'b';
    }).toThrow();
  });
});

describe('fillTemplate', () => {
  it('fills placeholders and merges origins', () => {
    const t = asPublic('Q: {{q}} R: {{r}}', 'app');
    const out = fillTemplate(t, { q: asPublic('why', 'cloud-response'), r: asPublic('R001', 'cartridge') });
    expect(out.value).toBe('Q: why R: R001');
    expect(isPublic(out)).toBe(true);
    expect([...out.origins].sort()).toEqual(['app', 'cartridge', 'cloud-response']);
  });

  it('refuses a Private value smuggled in by a cast', () => {
    const t = asPublic('Q: {{q}}', 'app');
    const priv = asPrivate('my diagram', 'diagram-label') as unknown as Public<string>;
    expect(() => fillTemplate(t, { q: priv })).toThrow(PrivacyError);
  });

  it('throws on a missing placeholder value', () => {
    expect(() => fillTemplate(asPublic('{{missing}}', 'app'), {})).toThrow(/missing/);
  });

  it('does not expand placeholders that appear inside values', () => {
    const t = asPublic('{{a}} {{b}}', 'app');
    const out = fillTemplate(t, { a: asPublic('{{b}}', 'app'), b: asPublic('x', 'app') });
    expect(out.value).toBe('{{b}} x');
  });
});

describe('declassify', () => {
  it('needs an approval granted for exactly the same text', () => {
    const q = asPrivate('How many latrines for 400 people?', 'user-question');
    const approval = grantApproval(q.value, { purpose: 'Ask the cloud', scope: 'ask' });
    const out = declassify(q, approval);
    expect(isPublic(out)).toBe(true);
    expect(out.value).toBe(q.value);
    expect(out.origins).toEqual(['declassified:ask']);
  });

  it('writes the approval to the egress log, with zero bytes sent', () => {
    const q = asPrivate('hello', 'user-question');
    declassify(q, grantApproval('hello', { purpose: 'Dev ping', scope: 'dev' }));
    const [entry] = egressLog.entries();
    expect(entry?.kind).toBe('declassify');
    expect(entry?.preview).toBe('hello');
    expect(entry?.bytesSent).toBe(0);
    expect(entry?.scope).toBe('dev');
  });

  it('refuses when the preview differs from the value', () => {
    const q = asPrivate('the real text', 'user-question');
    const approval = grantApproval('something else', { purpose: 'x', scope: 'ask' });
    expect(() => declassify(q, approval)).toThrow(/does not match/);
    expect(egressLog.entries()).toHaveLength(0);
  });

  it('refuses a forged approval', () => {
    const q = asPrivate('abc', 'user-question');
    const fake = { id: 'x', preview: 'abc', purpose: 'x', scope: 'ask' as const, approvedAt: '' };
    expect(() => declassify(q, fake)).toThrow(/grantApproval/);
  });

  it('refuses to reuse an approval', () => {
    const q = asPrivate('abc', 'user-question');
    const approval = grantApproval('abc', { purpose: 'x', scope: 'ask' });
    declassify(q, approval);
    expect(() => declassify(q, approval)).toThrow(/already been used/);
  });

  it('refuses a value that is not a minted Private', () => {
    const fake = { value: 'abc', origin: 'user-question' } as unknown as Parameters<typeof declassify>[0];
    expect(() => declassify(fake, grantApproval('abc', { purpose: 'x', scope: 'ask' }))).toThrow(
      /not a Private/,
    );
  });
});
