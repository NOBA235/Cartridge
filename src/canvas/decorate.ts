/**
 * How each checked connection looks on the canvas, and the scene changes that
 * make it look that way. Pure: the caller applies the plan with Excalidraw.
 *
 * Verdict mode (the connection test passed on this device with these rules):
 * - VIOLATION: red, badge '[R012 CRITICAL]'.
 * - COMPLIANT_VIA_EXCEPTION: green, '[R012 exception]'.
 * - COMPLIANT: green, '[R012 compliant]'.
 * Advisory mode (otherwise): never red as a verdict and never green.
 * - VIOLATION: amber, 'Possible violation, review R012'.
 * - COMPLIANT and COMPLIANT_VIA_EXCEPTION: grey, 'Not checked'.
 * Both modes:
 * - OUT_OF_SCOPE: dashed grey, 'Not covered'.
 * - UNCERTAIN: amber, 'Review R012' (never red or green).
 */
import type { EdgeStatus } from './edges';
import type { EdgeVerdict } from './evaluate';
import {
  arrowMidpoint,
  CARTRIDGE_TAG,
  cartridgeData,
  type CartridgeData,
  type SceneElement,
} from './scene';

export type CanvasMode = 'verdict' | 'advisory';

export const COLOURS = {
  red: '#e03131',
  green: '#2f9e44',
  amber: '#f08c00',
  grey: '#868e96',
} as const;

export interface EdgeLook {
  strokeColor: string;
  strokeStyle: 'solid' | 'dashed';
  badge: string;
  /** For the inspector and screen readers. */
  tone: 'violation' | 'ok' | 'review' | 'none';
}

export function lookFor(
  status: EdgeStatus,
  ruleId: string | undefined,
  severity: string | undefined,
  mode: CanvasMode,
): EdgeLook {
  const r = ruleId ?? '';
  const solid = 'solid' as const;
  switch (status) {
    case 'VIOLATION':
      return mode === 'verdict'
        ? {
            strokeColor: COLOURS.red,
            strokeStyle: solid,
            badge: `[${r} ${(severity ?? '').toUpperCase()}]`.replace(' ]', ']'),
            tone: 'violation',
          }
        : {
            strokeColor: COLOURS.amber,
            strokeStyle: solid,
            badge: `Possible violation, review ${r}`,
            tone: 'review',
          };
    case 'COMPLIANT_VIA_EXCEPTION':
      return mode === 'verdict'
        ? { strokeColor: COLOURS.green, strokeStyle: solid, badge: `[${r} exception]`, tone: 'ok' }
        : { strokeColor: COLOURS.grey, strokeStyle: solid, badge: 'Not checked', tone: 'none' };
    case 'COMPLIANT':
      return mode === 'verdict'
        ? { strokeColor: COLOURS.green, strokeStyle: solid, badge: `[${r} compliant]`, tone: 'ok' }
        : { strokeColor: COLOURS.grey, strokeStyle: solid, badge: 'Not checked', tone: 'none' };
    case 'OUT_OF_SCOPE':
      return {
        strokeColor: COLOURS.grey,
        strokeStyle: 'dashed',
        badge: 'Not covered',
        tone: 'none',
      };
    case 'UNCERTAIN':
      return {
        strokeColor: COLOURS.amber,
        strokeStyle: solid,
        badge: r ? `Review ${r}` : 'Review',
        tone: 'review',
      };
  }
}

export function lookForVerdict(v: EdgeVerdict, mode: CanvasMode): EdgeLook {
  return lookFor(v.status, v.rule?.id, v.rule?.severity, mode);
}

export const badgeId = (arrowId: string) => `cartridge-badge-${arrowId}`;

export interface ArrowChange {
  id: string;
  strokeColor: string;
  strokeStyle: string;
  customData: Record<string, unknown>;
}

export interface BadgeSpec {
  id: string;
  arrowId: string;
  text: string;
  strokeColor: string;
  x: number;
  y: number;
}

export interface DecorationPlan {
  arrows: ArrowChange[];
  /** Badges to create or replace (text, colour or position changed). */
  badges: BadgeSpec[];
  /** Badge ids to delete. */
  removeBadges: string[];
}

const BADGE_OFFSET_Y = 14;

function withTag(e: SceneElement, data: CartridgeData): Record<string, unknown> {
  return { ...(e.customData ?? {}), [CARTRIDGE_TAG]: data };
}

/**
 * What to change so every arrow in `looks` shows its look, every other arrow
 * gets its own style back, and badges match. Empty when the scene already
 * matches, so applying it never loops.
 */
export function planDecorations(
  elements: readonly SceneElement[],
  looks: ReadonlyMap<string, EdgeLook>,
): DecorationPlan {
  const live = elements.filter((e) => !e.isDeleted);
  const byId = new Map(live.map((e) => [e.id, e]));
  const plan: DecorationPlan = { arrows: [], badges: [], removeBadges: [] };

  for (const e of live) {
    if (e.type !== 'arrow') continue;
    const data = cartridgeData(e);
    const own =
      data?.kind === 'arrow'
        ? { strokeColor: data.strokeColor, strokeStyle: data.strokeStyle }
        : { strokeColor: e.strokeColor ?? '#1e1e1e', strokeStyle: e.strokeStyle ?? 'solid' };
    const look = looks.get(e.id);
    if (look) {
      if (
        e.strokeColor !== look.strokeColor ||
        e.strokeStyle !== look.strokeStyle ||
        data?.kind !== 'arrow'
      ) {
        plan.arrows.push({
          id: e.id,
          strokeColor: look.strokeColor,
          strokeStyle: look.strokeStyle,
          customData: withTag(e, { kind: 'arrow', ...own }),
        });
      }
    } else if (data?.kind === 'arrow') {
      const rest = Object.fromEntries(
        Object.entries(e.customData ?? {}).filter(([k]) => k !== CARTRIDGE_TAG),
      );
      plan.arrows.push({
        id: e.id,
        strokeColor: own.strokeColor,
        strokeStyle: own.strokeStyle,
        customData: rest,
      });
    }
  }

  const wanted = new Set<string>();
  for (const [arrowId, look] of looks) {
    const arrow = byId.get(arrowId);
    if (!arrow) continue;
    const id = badgeId(arrowId);
    wanted.add(id);
    const mid = arrowMidpoint(arrow);
    const x = Math.round(mid.x);
    const y = Math.round(mid.y + BADGE_OFFSET_Y);
    const cur = byId.get(id);
    if (
      !cur ||
      cur.text !== look.badge ||
      cur.strokeColor !== look.strokeColor ||
      Math.round(cur.x) !== x ||
      Math.round(cur.y) !== y
    ) {
      plan.badges.push({ id, arrowId, text: look.badge, strokeColor: look.strokeColor, x, y });
    }
  }
  for (const e of live) {
    if (cartridgeData(e)?.kind === 'badge' && !wanted.has(e.id)) plan.removeBadges.push(e.id);
  }
  return plan;
}

export function isEmptyPlan(p: DecorationPlan): boolean {
  return p.arrows.length === 0 && p.badges.length === 0 && p.removeBadges.length === 0;
}

/** Excalidraw functions applyPlan needs (passed in, because Excalidraw needs a browser). */
export interface ElementTools<E extends { id: string }> {
  /** Builds badge text elements from skeletons, keeping their ids. */
  makeBadges(specs: ReadonlyArray<Record<string, unknown>>): readonly E[];
  /** A copy of the element with these fields changed (and its version bumped). */
  update(e: E, fields: Record<string, unknown>): E;
}

/** Badge text: small, no wobble, locked so it cannot be dragged or edited, tagged as ours. */
export function badgeSkeleton(b: BadgeSpec, fontFamily: number): Record<string, unknown> {
  return {
    type: 'text',
    id: b.id,
    x: b.x,
    y: b.y,
    text: b.text,
    fontSize: 14,
    fontFamily,
    strokeColor: b.strokeColor,
    roughness: 0,
    locked: true,
    customData: { [CARTRIDGE_TAG]: { kind: 'badge', arrowId: b.arrowId } satisfies CartridgeData },
  };
}

/** The scene after the plan: arrows recoloured, old badges deleted, new or changed badges in place. */
export function applyPlan<E extends { id: string }>(
  elements: readonly E[],
  plan: DecorationPlan,
  tools: ElementTools<E>,
  fontFamily: number,
): E[] {
  const arrows = new Map(plan.arrows.map((a) => [a.id, a]));
  const remove = new Set(plan.removeBadges);
  const badges = new Map(
    tools.makeBadges(plan.badges.map((b) => badgeSkeleton(b, fontFamily))).map((e) => [e.id, e]),
  );
  const next = elements.map((e) => {
    const change = arrows.get(e.id);
    if (change) {
      return tools.update(e, {
        strokeColor: change.strokeColor,
        strokeStyle: change.strokeStyle,
        customData: change.customData,
      });
    }
    if (remove.has(e.id)) return tools.update(e, { isDeleted: true });
    const badge = badges.get(e.id);
    if (badge) {
      badges.delete(e.id);
      return badge;
    }
    return e;
  });
  return [...next, ...badges.values()];
}
