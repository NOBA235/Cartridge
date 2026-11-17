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
import {
  classifyCloudFailure,
  CloudError,
  createCloudClient,
  type CloudModelLike,
  type CloudTask,
} from './cloud';

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

/** A client whose waits are recorded instead of slept. */
function withSleep(model: CloudModelLike, waits: number[]) {
  return createCloudClient({
    getModel: () => model,
    isOnline: () => true,
    maxRetries: 2,
    sleep: async (ms) => {
      waits.push(ms);
    },
  });
}

/** Shaped like the SDK's AIError for a failed HTTP response. */
function httpError(status: number, retryDelay?: string, text = 'error') {
  return Object.assign(new Error(`Error fetching from https://x: [${status} Status] ${text}`), {
    code: 'fetch-error',
    customErrorData: {
      status,
      ...(retryDelay
        ? { errorDetails: [{ '@type': 'type.googleapis.com/google.rpc.RetryInfo', retryDelay }] }
        : {}),
    },
  });
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

  it('waits and retries after a usage limit, then says so', async () => {
    const { model, generateContent } = fakeModel([httpError(429), httpError(429), httpError(429)]);
    const waits: number[] = [];
    const err = await withSleep(model, waits)(task, asPublic('p', 'app'), ReplySchema).catch(
      (e: unknown) => e,
    );
    expect(err).toMatchObject({ code: 'QUOTA', attempts: 3 });
    expect((err as Error).message).toBe(
      "The cloud's usage limit was reached. Try again in a few minutes.",
    );
    expect(waits).toEqual([2000, 8000]);
    expect(generateContent).toHaveBeenCalledTimes(3);
  });

  it('uses the wait the server asks for, and does not wait longer than the limit', async () => {
    const short = fakeModel([httpError(429, '3s'), '{"reply":"ok"}']);
    const waits: number[] = [];
    const res = await withSleep(short.model, waits)(task, asPublic('p', 'app'), ReplySchema);
    expect(res.attempts).toBe(2);
    expect(waits).toEqual([3000]);

    const long = fakeModel([httpError(429, '45s'), '{"reply":"never"}']);
    const none: number[] = [];
    await expect(
      withSleep(long.model, none)(task, asPublic('p', 'app'), ReplySchema),
    ).rejects.toMatchObject({ code: 'QUOTA', attempts: 1 });
    expect(none).toEqual([]);
    expect(long.generateContent).toHaveBeenCalledOnce();
  });

  it('does not retry a refusal, and says what to fix', async () => {
    for (const e of [
      httpError(401, undefined, 'Firebase App Check token is invalid.'),
      httpError(403),
      httpError(400),
      Object.assign(new Error('The Firebase AI SDK requires the Firebase AI API'), {
        code: 'api-not-enabled',
      }),
    ]) {
      const { model, generateContent } = fakeModel([e, '{"reply":"never"}']);
      const err = await client(model)(task, asPublic('p', 'app'), ReplySchema).catch(
        (x: unknown) => x,
      );
      expect(err).toMatchObject({ code: 'REFUSED', attempts: 1 });
      expect(generateContent).toHaveBeenCalledOnce();
    }
    const appCheck = fakeModel([httpError(401, undefined, 'App Check token is invalid.')]);
    await expect(client(appCheck.model)(task, asPublic('p', 'app'), ReplySchema)).rejects.toThrow(
      /register the debug token/,
    );
  });

  it('retries a server error after a wait', async () => {
    const { model } = fakeModel([httpError(503), '{"reply":"ok"}']);
    const waits: number[] = [];
    const res = await withSleep(model, waits)(task, asPublic('p', 'app'), ReplySchema);
    expect(res.attempts).toBe(2);
    expect(waits).toEqual([2000]);
  });

  it('ends as OFFLINE when the signal drops during the call', async () => {
    let online = true;
    const generateContent = vi.fn(async () => {
      online = false;
      throw new TypeError('Failed to fetch');
    });
    const c = createCloudClient({
      getModel: () => ({ generateContent }),
      isOnline: () => online,
      maxRetries: 2,
    });
    await expect(c(task, asPublic('p', 'app'), ReplySchema)).rejects.toMatchObject({
      code: 'OFFLINE',
      attempts: 1,
    });
    expect(generateContent).toHaveBeenCalledOnce();
    expect(egressLog.entries()).toHaveLength(1);
  });

  it('classifies failures from the SDK message when there is no status field', () => {
    expect(
      classifyCloudFailure(new Error('Error fetching from x: [429 Too Many Requests] quota')),
    ).toEqual({ kind: 'quota' });
    expect(classifyCloudFailure(new Error('[500 Internal Server Error]'))).toEqual({
      kind: 'server',
    });
    expect(classifyCloudFailure(new Error('RESOURCE_EXHAUSTED'))).toEqual({ kind: 'quota' });
    expect(classifyCloudFailure(new TypeError('Failed to fetch'))).toEqual({ kind: 'network' });
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
