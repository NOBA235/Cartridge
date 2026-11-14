/**
 * Type tests: run by `vitest` (typecheck mode) and by `tsc -b`.
 * Each @ts-expect-error line must fail to compile; if one compiles, the build fails.
 */
import { describe, expectTypeOf, it } from 'vitest';
import { Schema } from 'firebase/ai';
import { z } from 'zod';
import { cloudJson, type CloudTask } from '@/ai/cloud';
import { asPrivate, asPublic, declassify, fillTemplate, grantApproval, type Private, type Public } from './index';

const task: CloudTask = { name: 'DEV_PING', responseSchema: Schema.object({ properties: {} }) };
const schema = z.object({});

describe('cloud tasks accept only Public values', () => {
  it('accepts Public<string>', () => {
    expectTypeOf(cloudJson).parameter(1).toEqualTypeOf<Public<string>>();
    void (() => cloudJson(task, asPublic('ok', 'app'), schema));
  });

  it('rejects Private<string>', () => {
    const priv = asPrivate('user text', 'user-question');
    // @ts-expect-error Private values cannot be sent to the cloud
    void (() => cloudJson(task, priv, schema));
    expectTypeOf<Private<string>>().not.toExtend<Public<string>>();
  });

  it('rejects plain strings and look-alike objects', () => {
    // @ts-expect-error plain strings are not Public
    void (() => cloudJson(task, 'plain', schema));
    // @ts-expect-error a structural copy without the brand is not Public
    void (() => cloudJson(task, { value: 'x', origins: ['app'] }, schema));
    expectTypeOf<string>().not.toExtend<Public<string>>();
  });

  it('fillTemplate only takes Public parts', () => {
    const t = asPublic('{{q}}', 'app');
    // @ts-expect-error Private values cannot be put into a cloud prompt
    void (() => fillTemplate(t, { q: asPrivate('x', 'user-note') }));
    // @ts-expect-error the template itself must be Public
    void (() => fillTemplate('{{q}}', { q: asPublic('x', 'app') }));
  });

  it('asPublic cannot claim the declassified origin', () => {
    // @ts-expect-error only declassify() may produce declassified values
    void (() => asPublic('x', 'declassified:ask'));
  });

  it('declassify turns Private into Public and needs an Approval', () => {
    const priv = asPrivate('x', 'user-question');
    expectTypeOf(declassify(priv, grantApproval('x', { purpose: 'p', scope: 'ask' }))).toEqualTypeOf<
      Public<string>
    >();
    // @ts-expect-error an approval is required
    void (() => declassify(priv));
    // @ts-expect-error declassify takes Private, not Public
    void (() => declassify(asPublic('x', 'app'), grantApproval('x', { purpose: 'p', scope: 'ask' })));
  });
});
