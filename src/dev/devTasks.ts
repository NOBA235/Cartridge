/** /dev page cloud task: a minimal structured call that proves the cloud path works. */
import { Schema } from 'firebase/ai';
import { z } from 'zod';
import type { CloudTask } from '@/ai/cloud';

export const DEV_PING_TASK: CloudTask = {
  name: 'DEV_PING',
  responseSchema: Schema.object({ properties: { reply: Schema.string() } }),
};

export const DevPingReply = z.object({ reply: z.string() });
