/**
 * Real cloud call through Firebase AI Logic, with App Check. Not part of
 * `npm test`: it uses the network and your quota. Run with `npm run smoke:cloud`.
 *
 * Needs .env.local with the VITE_FIREBASE_* values and VITE_APPCHECK_DEBUG_TOKEN
 * set to a token registered in Firebase console > App Check > Manage debug tokens.
 * (In Node there is no IndexedDB, so the SDK cannot keep a generated token.)
 *
 * The App Check SDK prints the debug token to the console in debug mode; this
 * test drops that line so the token never ends up in terminal or CI logs.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { DEV_PING_TASK, DevPingReply } from '@/dev/devTasks';
import { asPublic, fillTemplate } from '@/privacy';
import { egressLog } from '@/telemetry/egress';
import { cloudJson, CloudError } from './cloud';
import { getFirebase } from './firebase';
import { DEV_PING_TEMPLATE } from './prompts';

const realLog = console.log.bind(console);

beforeAll(() => {
  vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
    if (args.some((a) => typeof a === 'string' && /debug token/i.test(a))) return;
    realLog(...args);
  });
});

afterAll(() => vi.restoreAllMocks());

describe('real cloud call (smoke)', () => {
  it('gets a structured reply from the cloud model', async () => {
    if (!import.meta.env.VITE_APPCHECK_DEBUG_TOKEN) {
      throw new Error(
        'Set VITE_APPCHECK_DEBUG_TOKEN in .env.local to a token registered in Firebase console > App Check > Manage debug tokens.',
      );
    }
    const fb = getFirebase();
    if (!fb.ok) throw new Error(fb.reason);
    expect(fb.appCheckMode).toBe('debug');

    const prompt = fillTemplate(DEV_PING_TEMPLATE, {
      message: asPublic('Say hello in five words.', 'app'),
    });
    try {
      const res = await cloudJson(DEV_PING_TASK, prompt, DevPingReply);
      realLog(
        `[smoke] reply=${JSON.stringify(res.data.reply)} inferenceSource=${res.inferenceSource} attempts=${res.attempts} bytesSent=${egressLog.totalBytesSent()}`,
      );
      expect(res.inferenceSource).toBe('in_cloud');
      expect(res.data.reply.trim().length).toBeGreaterThan(0);
      expect(egressLog.entries().at(-1)?.status).toBe('ok');
    } catch (e) {
      if (e instanceof CloudError) {
        e.causes.forEach((c, i) => realLog(`[smoke] attempt ${i + 1} failed: ${c}`));
      }
      throw e;
    }
  }, 120_000);
});
