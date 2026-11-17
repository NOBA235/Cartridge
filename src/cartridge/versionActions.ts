/** App actions on stored versions and suggestions. Everything stays on this device. */
import { loadAskContext } from './askSession';
import { approveProposal, ProposalError, type ProposalRecord } from './proposals';
import { cartridgesStore, proposalsStore } from './store';
import type { Cartridge, Rule } from './types';
import { restoreVersion } from './versions';

async function pending(proposalId: string): Promise<ProposalRecord> {
  const record = await proposalsStore.get(proposalId);
  if (!record) throw new ProposalError('This suggestion is no longer on this device.');
  if (record.status !== 'pending') throw new ProposalError('This suggestion was already decided.');
  return record;
}

/** Adds the suggested rule as version N+1 of the current version. */
export async function approveSuggestion(
  proposalId: string,
  now: Date = new Date(),
): Promise<{ cartridge: Cartridge; rule: Rule; record: ProposalRecord }> {
  const record = await pending(proposalId);
  const ctx = await loadAskContext(record.cartridgeId);
  if (!ctx) throw new ProposalError('This cartridge is no longer on this device.');
  const every = (await cartridgesStore.versions(record.cartridgeId)).flatMap((v) =>
    v.rules.map((r) => r.id),
  );
  const { cartridge, rule } = approveProposal(record, {
    current: ctx.cartridge,
    everyRuleId: every,
    source: ctx.source,
    ...(ctx.prepared ? { prepared: ctx.prepared } : {}),
    now,
  });
  const decided: ProposalRecord = {
    ...record,
    status: 'approved',
    decidedAt: now.toISOString(),
    approvedVersion: cartridge.version,
    ruleId: rule.id,
  };
  await cartridgesStore.saveVersionWithProposal(cartridge, ctx.record.sourceId, decided);
  return { cartridge, rule, record: decided };
}

export async function rejectSuggestion(proposalId: string, now: Date = new Date()): Promise<void> {
  const record = await pending(proposalId);
  await proposalsStore.put({ ...record, status: 'rejected', decidedAt: now.toISOString() });
}

/** Makes version N+1 with the rules of an older version. Nothing is deleted. */
export async function restoreToVersion(
  cartridgeId: string,
  version: number,
  now: Date = new Date(),
): Promise<Cartridge> {
  const cur = await cartridgesStore.current(cartridgeId);
  if (!cur) throw new Error('This cartridge is no longer on this device.');
  const target = await cartridgesStore.version(cartridgeId, version);
  if (!target) throw new Error(`Version ${version} is not on this device.`);
  const next = restoreVersion(cur.cartridge, target, now);
  await cartridgesStore.saveVersion(next, cur.record.sourceId);
  return next;
}
