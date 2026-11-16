/**
 * One question, end to end (brief section 5):
 * 1. retrieve(): MiniSearch top 5. Under the threshold: LOW_RETRIEVAL, no model is asked.
 * 2. The device model sees only those candidates and the question, and returns
 *    { ruleId, quantity }.
 * 3. Code builds the answer from the rule; code does any arithmetic.
 * 4. Validators: the rule must be a candidate and its quote must verify.
 * 5. Otherwise the router escalates: cloud when online and allowed (after the
 *    user approves exactly what is sent), the offline queue when there is no
 *    signal, or nothing leaves the device when 'Ask the cloud when needed' is off.
 */
import { CloudError, type CloudJson } from '@/ai/cloud';
import { DeviceError, type DeviceModel } from '@/ai/deviceModel';
import { escalate, type EscalationReason } from '@/ai/router';
import { config } from '@/config';
import {
  asPublic,
  fillTemplate,
  renderTemplate,
  reveal,
  type Private,
  type Public,
} from '@/privacy';
import { answerFromRule, checkQuote, type Answer } from './answer';
import { CLOUD_ANSWER_PROMPT, CLOUD_ANSWER_TASK, CloudAnswerReply } from './askPrompts';
import { cleanQuote } from './compile';
import { RuleDraftSchema, type RuleDraft } from './compilePrompts';
import { formatPassages, passageIndexFor, type Passage } from './passages';
import type { RuleIndex } from './retrieve';
import type { SourceText } from './source';
import type { Cartridge, Rule } from './types';
import { validateSelection } from './validate';
import type { PreparedSource } from './verifyQuote';

export interface AskContext {
  cartridge: Cartridge;
  index: RuleIndex;
  /** The rulebook, when it is on this device. Needed to verify quotes and find passages. */
  source?: SourceText;
  prepared?: PreparedSource;
}

export interface DeviceHandle {
  model: DeviceModel;
  ready: boolean;
}

export type DeviceStep =
  | { kind: 'answered'; answer: Answer }
  | { kind: 'escalate'; reason: EscalationReason; detail: string };

const DETAIL: Record<'LOW_RETRIEVAL' | 'DEVICE_UNAVAILABLE', string> = {
  LOW_RETRIEVAL: 'No rule in this cartridge is close to this question, so no model was asked.',
  DEVICE_UNAVAILABLE: 'The on-device model is not ready on this device.',
};

export async function answerOnDevice(
  question: Private<string>,
  ctx: AskContext,
  device: DeviceHandle | undefined,
  now: () => Date = () => new Date(),
): Promise<DeviceStep> {
  const text = reveal(question);
  const retrieval = ctx.index.search(text);
  if (!retrieval.confident) {
    return { kind: 'escalate', reason: 'LOW_RETRIEVAL', detail: DETAIL.LOW_RETRIEVAL };
  }
  if (!device?.ready) {
    return { kind: 'escalate', reason: 'DEVICE_UNAVAILABLE', detail: DETAIL.DEVICE_UNAVAILABLE };
  }
  const candidates = retrieval.hits.map((h) => h.rule);
  let selection;
  try {
    selection = await device.model.selectRule({ question, candidates });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    const reason: EscalationReason =
      e instanceof DeviceError && e.code === 'NOT_PREPARED' ? 'DEVICE_UNAVAILABLE' : 'DEVICE_ERROR';
    return { kind: 'escalate', reason, detail: `The on-device model failed: ${message}` };
  }
  const v = validateSelection(selection, candidates, ctx.prepared);
  if (!v.ok) return { kind: 'escalate', reason: v.reason, detail: v.detail };
  const answer = answerFromRule(v.rule, {
    question: text,
    quantity: selection.quantity,
    route: 'ON_DEVICE',
    quoteCheck: v.quoteCheck,
    now: now(),
  });
  return { kind: 'answered', answer: { ...answer, deviceSource: selection.source } };
}

// ---------- cloud ----------

export interface CloudPlan {
  rulesJson: Public<string>;
  passages: Public<string>;
  passageList: Passage[];
  ruleIds: string[];
  /** Exactly the request that will be sent, rendered by the same code as the real prompt. */
  preview: string;
}

function ruleForCloud(r: Rule) {
  return {
    id: r.id,
    title: r.title,
    when: r.when,
    ...(r.notWhen ? { notWhen: r.notWhen } : {}),
    then: r.then,
    exceptions: r.exceptions,
    ...(r.calc ? { calc: r.calc } : {}),
  };
}

/** Builds the public parts of a cloud question. Rules and passages come from the public rulebook only. */
export function planCloudQuestion(questionText: string, ctx: AskContext): CloudPlan {
  const rules = ctx.index
    .search(questionText, { topK: config.ask.cloudRules, minScore: 0 })
    .hits.map((h) => h.rule);
  const passageList = ctx.source ? passageIndexFor(ctx.source).search(questionText) : [];
  const rulesJson = asPublic(JSON.stringify(rules.map(ruleForCloud), null, 1), 'cartridge');
  const passages = asPublic(formatPassages(passageList), 'source-document');
  const preview = renderTemplate(CLOUD_ANSWER_PROMPT.value, {
    rulesJson: rulesJson.value,
    passages: passages.value,
    question: questionText,
  });
  return { rulesJson, passages, passageList, ruleIds: rules.map((r) => r.id), preview };
}

export class AskError extends Error {
  override readonly name = 'AskError';
}

export interface CloudAnswer extends Answer {
  /** A new rule the cloud proposed, kept only if its quote verifies (reviewed in Phase 5). */
  proposal?: RuleDraft;
}

export async function askCloud(
  question: Public<string>,
  plan: CloudPlan,
  ctx: AskContext,
  cloud: CloudJson,
  reason: EscalationReason,
  now: () => Date = () => new Date(),
): Promise<CloudAnswer> {
  const prompt = fillTemplate(CLOUD_ANSWER_PROMPT, {
    rulesJson: plan.rulesJson,
    passages: plan.passages,
    question,
  });
  // The user approved a preview; refuse to send anything different.
  if (prompt.value !== plan.preview) {
    throw new AskError('The request no longer matches what you approved, so it was not sent.');
  }
  const { data } = await cloud(CLOUD_ANSWER_TASK, prompt, CloudAnswerReply);
  return interpretCloudReply(data, question.value, ctx, reason, now());
}

export function interpretCloudReply(
  data: CloudAnswerReply,
  questionText: string,
  ctx: AskContext,
  reason: EscalationReason,
  at: Date,
): CloudAnswer {
  const proposal = verifiedProposal(data.proposedRule, ctx.prepared);
  const extra = proposal ? { proposal } : {};
  const rule = data.ruleId ? ctx.cartridge.rules.find((r) => r.id === data.ruleId) : undefined;
  if (rule) {
    const answer = answerFromRule(rule, {
      question: questionText,
      quantity: data.quantity,
      route: 'IN_CLOUD',
      quoteCheck: checkQuote(rule.source.quote, ctx.prepared),
      reason,
      now: at,
    });
    return { ...answer, ...extra };
  }
  const base = {
    question: questionText,
    route: 'IN_CLOUD' as const,
    exceptions: [],
    reason,
    at: at.toISOString(),
  };
  if (!data.covered) {
    return {
      ...base,
      status: 'escalated',
      notCovered: true,
      detail: 'The cloud found nothing in this rulebook that answers this question.',
      ...extra,
    };
  }
  const quote = data.quote ? cleanQuote(data.quote) : '';
  const quoteCheck = quote ? checkQuote(quote, ctx.prepared) : { ok: false };
  return {
    ...base,
    status: quoteCheck.ok ? 'verified' : 'escalated',
    decision: data.answer,
    wordingFrom: 'cloud',
    ...(quote ? { quote, quoteCheck } : {}),
    ...(quoteCheck.page !== undefined ? { page: quoteCheck.page } : {}),
    ...extra,
  };
}

function verifiedProposal(
  raw: unknown,
  prepared: PreparedSource | undefined,
): RuleDraft | undefined {
  if (raw === null || raw === undefined || !prepared) return undefined;
  const parsed = RuleDraftSchema.safeParse(raw);
  if (!parsed.success) return undefined;
  const quote = cleanQuote(parsed.data.quote);
  return checkQuote(quote, prepared).ok ? { ...parsed.data, quote } : undefined;
}

// ---------- the whole question ----------

export interface ApprovalRequest {
  question: Private<string>;
  /** 'now': send to the cloud now. 'later': send when there is signal. */
  when: 'now' | 'later';
  reason: EscalationReason;
  detail: string;
  plan: CloudPlan;
}

export interface QueueInput {
  question: string;
  approved: Public<string>;
  reason: EscalationReason;
  cartridgeId: string;
  cartridgeVersion: number;
}

export interface AskDeps {
  device: DeviceHandle | undefined;
  cloud: CloudJson;
  online: () => boolean;
  /** 'Ask the cloud when needed' for the Ask screen. */
  cloudAllowed: boolean;
  /**
   * Shows the user exactly what will be sent and asks for approval. Resolves
   * with the declassified question, or null if the user keeps it on this device.
   */
  approve: (req: ApprovalRequest) => Promise<Public<string> | null>;
  /** Saves the question in the offline queue; returns its queue id. */
  enqueue: (item: QueueInput) => Promise<{ id: string }>;
  now?: () => Date;
}

function stayed(question: string, reason: EscalationReason, detail: string, at: Date): Answer {
  return {
    question,
    route: 'ON_DEVICE',
    status: 'unanswered',
    exceptions: [],
    reason,
    detail,
    at: at.toISOString(),
  };
}

export async function askQuestion(
  question: Private<string>,
  ctx: AskContext,
  deps: AskDeps,
): Promise<CloudAnswer> {
  const now = deps.now ?? (() => new Date());
  const text = reveal(question);
  const step = await answerOnDevice(question, ctx, deps.device, now);
  if (step.kind === 'answered') return step.answer;

  const decision = escalate(step.reason, {
    online: deps.online(),
    cloudAllowed: deps.cloudAllowed,
  });
  if (decision.route === 'local-only') {
    return stayed(
      text,
      step.reason,
      `${step.detail} 'Ask the cloud when needed' is off, so nothing was sent.`,
      now(),
    );
  }

  const plan = planCloudQuestion(text, ctx);
  const when = decision.route === 'queue' ? 'later' : 'now';
  const approved = await deps.approve({
    question,
    when,
    reason: step.reason,
    detail: step.detail,
    plan,
  });
  if (!approved)
    return stayed(text, step.reason, `${step.detail} You kept the question on this device.`, now());

  const queue = async (detail: string): Promise<Answer> => {
    const { id } = await deps.enqueue({
      question: text,
      approved,
      reason: step.reason,
      cartridgeId: ctx.cartridge.id,
      cartridgeVersion: ctx.cartridge.version,
    });
    return {
      question: text,
      route: 'QUEUED',
      status: 'queued',
      exceptions: [],
      reason: step.reason,
      detail,
      queueId: id,
      at: now().toISOString(),
    };
  };

  if (decision.route === 'queue')
    return queue(`${step.detail} No signal: it will be sent when there is signal.`);

  try {
    return await askCloud(approved, plan, ctx, deps.cloud, step.reason, now);
  } catch (e) {
    if (e instanceof CloudError && e.code === 'OFFLINE') {
      return queue(`${step.detail} The signal dropped: it will be sent when there is signal.`);
    }
    const message = e instanceof Error ? e.message : String(e);
    return {
      ...stayed(text, step.reason, `The cloud could not answer: ${message}`, now()),
      route: 'IN_CLOUD',
    };
  }
}
