/**
 * MOCK device model. Not Gemini Nano. Every result has source 'mock', and the
 * UI must badge it as mock.
 *
 * Picks the candidate with the largest keyword overlap with the question, or
 * NONE when nothing overlaps. With probability `errorRate` it returns a wrong
 * answer on purpose, so Exam Day and the escalation paths can be developed
 * without a real device. Deterministic for a given seed.
 */
import { NONE, type Rule } from '@/cartridge/types';
import { reveal } from '@/privacy';
import type { DeviceModel, DeviceSelection, DeviceStatus, SelectRuleInput } from './deviceModel';

export interface MockDeviceOptions {
  /** Probability between 0 and 1 of returning a wrong answer. */
  errorRate: number;
  seed?: number;
  /** Simulated download steps reported by prepare(). */
  progressSteps?: number;
}

/** mulberry32: small seeded PRNG so mock runs are reproducible. */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const STOPWORDS = new Set(
  'a an the of to in on for and or is are be do does i we you it my our what how when where which who can should must with at by from per this that there if as'.split(
    ' ',
  ),
);

export function tokens(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .normalize('NFKC')
      .split(/[^\p{L}\p{N}]+/u)
      .filter((t) => t.length > 1 && !STOPWORDS.has(t)),
  );
}

function overlapScore(questionTokens: Set<string>, rule: Rule): number {
  const keywordTokens = tokens(rule.keywords.join(' '));
  const otherTokens = tokens(`${rule.title} ${rule.when}`);
  let score = 0;
  for (const t of questionTokens) {
    if (keywordTokens.has(t)) score += 2;
    else if (otherTokens.has(t)) score += 1;
  }
  return score;
}

export function firstNumber(text: string): number {
  const m = text.replace(/(\d),(\d{3})/g, '$1$2').match(/\d+(?:\.\d+)?/);
  return m ? Number(m[0]) : -1;
}

export class MockDeviceModel implements DeviceModel {
  readonly kind = 'mock' as const;
  private readonly random: () => number;
  private readonly options: MockDeviceOptions;

  constructor(options: MockDeviceOptions) {
    if (!(options.errorRate >= 0 && options.errorRate <= 1)) {
      throw new Error('errorRate must be between 0 and 1');
    }
    this.options = options;
    this.random = seededRandom(options.seed ?? 42);
  }

  async prepare(onProgress: (fraction: number) => void): Promise<DeviceStatus> {
    const steps = this.options.progressSteps ?? 4;
    for (let i = 1; i <= steps; i++) onProgress(i / steps);
    return { state: 'ready', kind: this.kind };
  }

  async selectRule({ question, candidates }: SelectRuleInput): Promise<DeviceSelection> {
    const text = reveal(question);
    const q = tokens(text);
    let best: Rule | undefined;
    let bestScore = 0;
    for (const rule of candidates) {
      const s = overlapScore(q, rule);
      if (s > bestScore) {
        best = rule;
        bestScore = s;
      }
    }
    let ruleId: string = best?.id ?? NONE;

    if (this.random() < this.options.errorRate) {
      const wrong = [...candidates.map((r) => r.id), NONE].filter((id) => id !== ruleId);
      ruleId = wrong[Math.floor(this.random() * wrong.length)] ?? ruleId;
    }

    const chosen = candidates.find((r) => r.id === ruleId);
    const quantity = chosen?.calc ? firstNumber(text) : -1;
    return { ruleId, quantity, source: 'mock' };
  }
}
