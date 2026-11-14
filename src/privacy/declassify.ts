/**
 * declassify(): the only way for user material to cross from Private to Public.
 *
 * Flow:
 * 1. The UI shows the user exactly the text that will be sent (DeclassifyDialog).
 * 2. When the user presses Approve, the dialog calls grantApproval(previewText).
 * 3. declassify(value, approval) checks that the approval was minted here, has
 *    not been used before, and that its preview is character-for-character the
 *    value being released. Then it writes a 'declassify' entry to the egress
 *    log and returns a Public value tagged 'declassified:<scope>'.
 */
import { egressLog } from '@/telemetry/egress';
import {
  _mintDeclassified,
  isPrivate,
  PrivacyError,
  type DeclassifyScope,
  type Private,
  type Public,
} from './classified';

export interface Approval {
  readonly id: string;
  /** Exactly what the user saw and approved. */
  readonly preview: string;
  readonly purpose: string;
  readonly scope: DeclassifyScope;
  readonly approvedAt: string;
}

const minted = new WeakMap<Approval, { used: boolean }>();
let counter = 0;

/**
 * Called only from a user gesture (the Approve button in DeclassifyDialog).
 * Returns a single-use approval for exactly `preview`.
 */
export function grantApproval(
  preview: string,
  meta: { purpose: string; scope: DeclassifyScope },
): Approval {
  const approval: Approval = Object.freeze({
    id: `approval-${Date.now()}-${++counter}`,
    preview,
    purpose: meta.purpose,
    scope: meta.scope,
    approvedAt: new Date().toISOString(),
  });
  minted.set(approval, { used: false });
  return approval;
}

export function declassify(value: Private<string>, approval: Approval): Public<string> {
  if (!isPrivate(value)) {
    throw new PrivacyError('declassify: value is not a Private value created by asPrivate().');
  }
  const record = minted.get(approval);
  if (!record) {
    throw new PrivacyError('declassify: approval was not granted through grantApproval().');
  }
  if (record.used) {
    throw new PrivacyError('declassify: approval has already been used. Ask the user again.');
  }
  if (approval.preview !== value.value) {
    throw new PrivacyError('declassify: the approved preview does not match the value to send.');
  }
  record.used = true;
  egressLog.record({
    kind: 'declassify',
    label: approval.purpose,
    bytesSent: 0,
    text: value.value,
    origins: [`declassified:${approval.scope}`],
    scope: approval.scope,
    status: 'ok',
  });
  return _mintDeclassified(value.value, approval.scope);
}
