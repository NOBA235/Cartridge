/**
 * Reading a diagram: which connections it has.
 *
 * Works on the plain shape of Excalidraw elements (only the fields used here),
 * so it runs and is tested without a browser. No Excalidraw code is imported.
 *
 * - Nodes are rectangles, ellipses and diamonds with a text label bound to
 *   them, or free-standing text.
 * - A connection is an arrow bound at both ends to nodes, with an optional
 *   arrow label. Arrows bound at one end or none are counted for a hint.
 * - Every label is the user's own material: Private, so it can reach the
 *   on-device model and nothing else.
 * - Elements this app adds (badges) are tagged in customData and ignored.
 */
import { asPrivate, type Private } from '@/privacy';
import { formatEdge } from './edges';

export const CARTRIDGE_TAG = 'cartridge';

export interface SceneElement {
  readonly id: string;
  readonly type: string;
  readonly isDeleted?: boolean;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly text?: string;
  readonly containerId?: string | null;
  readonly startBinding?: { readonly elementId: string } | null;
  readonly endBinding?: { readonly elementId: string } | null;
  readonly points?: readonly (readonly [number, number])[];
  readonly strokeColor?: string;
  readonly strokeStyle?: string;
  readonly customData?: Readonly<Record<string, unknown>>;
}

export interface DiagramEdge {
  arrowId: string;
  fromId: string;
  toId: string;
  /** One plain line, as the evaluator and the connection test use: 'A --> B (label)'. */
  text: Private<string>;
}

export interface DiagramGraph {
  edges: DiagramEdge[];
  /** Arrows not attached to a named box at both ends. */
  looseArrows: number;
}

const SHAPES = new Set(['rectangle', 'ellipse', 'diamond']);

/** What this app keeps in an element's customData under CARTRIDGE_TAG. */
export type CartridgeData =
  | { kind: 'badge'; arrowId: string }
  /** The arrow's own style, kept so it can be put back when the arrow is no longer checked. */
  | { kind: 'arrow'; strokeColor: string; strokeStyle: string };

export function cartridgeData(e: SceneElement): CartridgeData | undefined {
  const d = e.customData?.[CARTRIDGE_TAG];
  if (!d || typeof d !== 'object') return undefined;
  const kind = (d as { kind?: unknown }).kind;
  return kind === 'badge' || kind === 'arrow' ? (d as CartridgeData) : undefined;
}

/** Elements this app added (badges); never part of the user's diagram. */
export function isOurs(e: SceneElement): boolean {
  return cartridgeData(e)?.kind === 'badge';
}

const clean = (s: string) => s.replace(/\s+/g, ' ').trim();

export function extractGraph(elements: readonly SceneElement[]): DiagramGraph {
  const live = elements.filter((e) => !e.isDeleted && !isOurs(e));
  const labelOf = new Map<string, string>();
  for (const e of live) {
    if (e.type === 'text' && e.containerId && e.text) {
      const prev = labelOf.get(e.containerId);
      labelOf.set(e.containerId, clean(prev ? `${prev} ${e.text}` : e.text));
    }
  }
  const nodeName = new Map<string, string>();
  for (const e of live) {
    if (SHAPES.has(e.type)) {
      const name = labelOf.get(e.id);
      if (name) nodeName.set(e.id, name);
    } else if (e.type === 'text' && !e.containerId && e.text && clean(e.text)) {
      nodeName.set(e.id, clean(e.text));
    }
  }

  const edges: DiagramEdge[] = [];
  let looseArrows = 0;
  for (const e of live) {
    if (e.type !== 'arrow') continue;
    const fromId = e.startBinding?.elementId;
    const toId = e.endBinding?.elementId;
    const from = fromId ? nodeName.get(fromId) : undefined;
    const to = toId ? nodeName.get(toId) : undefined;
    if (!fromId || !toId || !from || !to) {
      looseArrows++;
      continue;
    }
    const label = labelOf.get(e.id);
    edges.push({
      arrowId: e.id,
      fromId,
      toId,
      text: asPrivate(formatEdge({ from, to, ...(label ? { label } : {}) }), 'diagram-label'),
    });
  }
  return { edges, looseArrows };
}

/** The middle of an arrow, for its badge. */
export function arrowMidpoint(e: SceneElement): { x: number; y: number } {
  const pts = e.points ?? [];
  const first = pts[0] ?? [0, 0];
  const last = pts[pts.length - 1] ?? [e.width, e.height];
  return { x: e.x + (first[0] + last[0]) / 2, y: e.y + (first[1] + last[1]) / 2 };
}
