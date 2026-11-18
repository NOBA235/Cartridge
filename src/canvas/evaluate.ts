/**
 * Judges one connection against the cartridge, on this device only.
 *
 * 1. Retrieval (the same rule index as Ask) picks up to 5 candidate rules from
 *    the connection's text. With no candidate at all, the connection is not
 *    covered and no model is asked.
 * 2. Gemini Nano sees only this connection and those candidates, and reports
 *    facts (EdgeFacts), never a verdict.
 * 3. Validators (as in Ask): the matched rule must be one of the candidates,
 *    and its quote must verify against the rulebook on this device.
 *    Otherwise the connection is UNCERTAIN: amber, never red or green.
 * 4. decide() turns the facts into a status.
 *
 * Nothing here calls the cloud. A connection the cartridge does not cover is
 * flagged locally.
 */
import {
  DeviceError,
  type DeviceEdgeFacts,
  type DeviceSource,
  type EdgeDeviceModel,
} from '@/ai/deviceModel';
import type { AskContext } from '@/cartridge/ask';
import { checkQuote, type QuoteCheckResult } from '@/cartridge/answer';
import type { Rule } from '@/cartridge/types';
import { config } from '@/config';
import { reveal, type Classified } from '@/privacy';
import { decide, type EdgeFacts, type EdgeStatus } from './edges';

export interface EdgeVerdict {
  status: EdgeStatus;
  /** The rule the status is about (from the cartridge, never from the model). */
  rule?: Rule;
  quoteCheck?: QuoteCheckResult;
  facts?: EdgeFacts;
  candidates: string[];
  /** Why, in plain words. */
  detail: string;
  source?: DeviceSource;
  latencyMs?: number;
}

export async function evaluateEdge(
  edge: Classified<string>,
  ctx: AskContext,
  model: EdgeDeviceModel,
  clock: () => number = () => performance.now(),
): Promise<EdgeVerdict> {
  const retrieval = ctx.index.search(reveal(edge), {
    topK: config.edgeBench.topK,
    minScore: 0,
  });
  const candidateRules = retrieval.hits.map((h) => h.rule);
  const candidates = candidateRules.map((r) => r.id);
  if (candidateRules.length === 0) {
    return {
      status: 'OUT_OF_SCOPE',
      candidates,
      detail: 'No rule in this cartridge shares a word with this connection.',
    };
  }

  const started = clock();
  let reported: DeviceEdgeFacts;
  try {
    reported = await model.reportFacts({ edge, candidates: candidateRules });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    const notReady = e instanceof DeviceError && e.code === 'NOT_PREPARED';
    return {
      status: 'UNCERTAIN',
      candidates,
      detail: notReady
        ? 'Gemini Nano is not ready on this device, so this connection was not checked.'
        : `The on-device model failed: ${message}`,
    };
  }
  const latencyMs = clock() - started;
  const { source, ...facts } = reported;
  const base = { candidates, facts, source, latencyMs };

  if (facts.outOfScope || facts.matchedRuleId === null) {
    return { ...base, status: 'OUT_OF_SCOPE', detail: 'No rule in this cartridge covers it.' };
  }
  const rule = candidateRules.find((r) => r.id === facts.matchedRuleId);
  if (!rule) {
    return {
      ...base,
      status: 'UNCERTAIN',
      detail: `The device chose ${facts.matchedRuleId}, which was not one of the rules it was shown.`,
    };
  }
  const quoteCheck = checkQuote(rule.source.quote, ctx.prepared);
  if (!quoteCheck.ok) {
    return {
      ...base,
      status: 'UNCERTAIN',
      rule,
      quoteCheck,
      detail: ctx.prepared
        ? `The quote of ${rule.id} was not found in the rulebook.`
        : `The rulebook is not on this device, so the quote of ${rule.id} cannot be checked.`,
    };
  }
  const status = decide(facts, rule);
  return {
    ...base,
    status,
    rule,
    quoteCheck,
    detail:
      status === 'UNCERTAIN'
        ? `The device named an exception that ${rule.id} does not list.`
        : status === 'VIOLATION'
          ? `Meets the situation of ${rule.id} and none of its exceptions.`
          : status === 'COMPLIANT_VIA_EXCEPTION'
            ? `Meets the situation of ${rule.id}, but one of its exceptions applies.`
            : `Related to ${rule.id}, but does not meet its situation.`,
  };
}
