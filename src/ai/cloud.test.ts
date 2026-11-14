import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Schema } from 'firebase/ai';
import { z } from 'zod';
import {
  asPrivate,
  asPublic,
  declassify,
  fillTemplate,
  grantApproval,
  PrivacyError,
  type Public,
} from '@/privacy';
import { egressLog } from '@/telemetry/egress';
import { CloudError, createCloudClient, type CloudModelLike, type CloudTask } from './cloud';

const task: CloudTask = {
  name: 'DEV_PING',
  responseSchema: Schema.object({ properties: { reply: Schema.string() } }),
};
const ReplySchema = z.object({ reply: z.string() });

function fakeModel(replies: Array<string | Error>) {
  const generateContent = vi.fn(async (_prompt: string) => {
    const next = replies.shift();
    if (next === undefined) throw new Error('no more fake replies');
    if (next instanceof Error) throw next;
    return { response: { text: () => next, inferenceSource: 'in_cloud' } };
  });
  return { model: { generateContent } satisfies CloudModelLike, generateContent };
}

function client(model: CloudModelLike, online = true) {
  return createCloudClient({ getModel: () => model, isOnline: () => online, maxRetries: 2 });
}

beforeEach(() => egressLog._reset());

describe('cloudJson', () => {
  it('returns validated data and logs one cloud call with the prompt size', async () => {
    const { model } = fakeModel(['{"reply":"pong"}']);
    const res = await client(model)(task, asPublic('ping é', 'app'), ReplySchema);
    expect(res.data).toEqual({ reply: 'pong' });
    expect(res.inferenceSource).toBe('in_cloud');
    expect(res.attempts).toBe(1);
    const entries = egressLog.entries();
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      kind: 'cloud-call',
      label: 'DEV_PING',
      status: 'ok',
      bytesSent: 7,
    });
    expect(entries[0]?.preview).toBe('ping é');
  });

  it('retries after malformed JSON and after a shape mismatch', async () => {
    const { model, generateContent } = fakeModel(['not json', '{"wrong":1}', '{"reply":"ok"}']);
    const res = await client(model)(task, asPublic('p', 'app'), ReplySchema);
    expect(res.attempts).toBe(3);
    expect(generateContent).toHaveBeenCalledTimes(3);
    expect(egressLog.entries().map((e) => e.status)).toEqual(['error', 'error', 'ok']);
  });

  it('gives up after 2 retries and still counts the bytes of failed attempts', async () => {
    const { model, generateContent } = fakeModel([
      new Error('quota'),
      new Error('quota'),
      new Error('quota'),
      '{"reply":"late"}',
    ]);
    await expect(client(model)(task, asPublic('abc', 'app'), ReplySchema)).rejects.toMatchObject({
      code: 'FAILED',
      attempts: 3,
    });
    expect(generateContent).toHaveBeenCalledTimes(3);
    expect(egressLog.totalBytesSent()).toBe(9);
  });

  it('rejects a Private value at run time without calling the model or logging', async () => {
    const { model, generateContent } = fakeModel(['{"reply":"x"}']);
    const priv = asPrivate('my private diagram', 'diagram-label') as unknown as Public<string>;
    await expect(client(model)(task, priv, ReplySchema)).rejects.toBeInstanceOf(PrivacyError);
    expect(generateContent).not.toHaveBeenCalled();
    expect(egressLog.entries()).toHaveLength(0);
  });

  it('rejects a plain string at run time', async () => {
    const { model, generateContent } = fakeModel(['{"reply":"x"}']);
    await expect(
      client(model)(task, 'plain' as unknown as Public<string>, ReplySchema),
    ).rejects.toBeInstanceOf(PrivacyError);
    expect(generateContent).not.toHaveBeenCalled();
  });

  it('does not call the cloud while offline', async () => {
    const { model, generateContent } = fakeModel(['{"reply":"x"}']);
    const err = await client(model, false)(task, asPublic('p', 'app'), ReplySchema).catch(
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(CloudError);
    expect((err as CloudError).code).toBe('OFFLINE');
    expect(generateContent).not.toHaveBeenCalled();
    expect(egressLog.entries()).toHaveLength(0);
  });

  it('tags egress entries that carry declassified user material', async () => {
    const { model } = fakeModel(['{"reply":"x"}']);
    const q = asPrivate('question', 'user-question');
    const pub = declassify(q, grantApproval('question', { purpose: 'Dev ping', scope: 'dev' }));
    const prompt = fillTemplate(asPublic('Q: {{q}}', 'app'), { q: pub });
    await client(model)(task, prompt, ReplySchema);
    expect(egressLog.bytesSentFromScope('dev')).toBe('Q: question'.length);
    expect(egressLog.bytesSentFromScope('canvas')).toBe(0);
  });
});
