/**
 * Router skeleton (brief section 5). Pure decisions only; Phase 3 wires it into
 * the Ask pipeline.
 *
 * The device is always tried first. When the device cannot give a verified
 * answer, escalate() decides between the cloud, the offline queue, or staying
 * local because the user switched the cloud off.
 */
export type EscalationReason =
  | 'NO_MATCH'
  | 'LOW_RETRIEVAL'
  | 'VALIDATION_FAILED'
  | 'DEVICE_ERROR'
  | 'DEVICE_UNAVAILABLE'
  | 'USER_REQUESTED';

export interface RouteContext {
  /** Real connectivity, and false while 'Simulated no signal' is on. */
  online: boolean;
  /** The 'Ask the cloud when needed' setting for this screen. */
  cloudAllowed: boolean;
}

export type EscalationDecision =
  | { route: 'cloud'; reason: EscalationReason }
  | { route: 'queue'; reason: EscalationReason }
  | { route: 'local-only'; reason: EscalationReason };

export function escalate(reason: EscalationReason, ctx: RouteContext): EscalationDecision {
  // The privacy promise: questions go to the cloud only while the setting is on.
  // That holds for USER_REQUESTED too.
  if (!ctx.cloudAllowed) return { route: 'local-only', reason };
  if (!ctx.online) return { route: 'queue', reason };
  return { route: 'cloud', reason };
}

export type FirstRoute = { route: 'device' } | EscalationDecision;

/** Where a new question goes first. */
export function firstRoute(deviceReady: boolean, ctx: RouteContext): FirstRoute {
  return deviceReady ? { route: 'device' } : escalate('DEVICE_UNAVAILABLE', ctx);
}
