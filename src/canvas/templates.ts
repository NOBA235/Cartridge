/**
 * Three starting diagrams. Their arrows are made with addBoundArrow(), so they
 * are real connections. Once on the canvas they are the user's diagram, and
 * their labels are treated like anything the user draws (Private).
 */
import type { ExcalidrawElement } from '@excalidraw/excalidraw/element/types';
import type { ExcalidrawElementSkeleton } from '@excalidraw/excalidraw/data/transform';
import { addBoundArrow, memoryScene, type Convert } from './arrows';

export interface Template {
  id: string;
  name: string;
  /** [column, row] on a grid, and the box label. */
  nodes: ReadonlyArray<{ key: string; at: readonly [number, number]; label: string }>;
  edges: ReadonlyArray<{ from: string; to: string; label?: string }>;
}

export const TEMPLATES: readonly Template[] = [
  {
    id: 'web-service',
    name: 'Web service',
    nodes: [
      { key: 'browser', at: [0, 0], label: 'Customer browser' },
      { key: 'gateway', at: [1, 0], label: 'API gateway' },
      { key: 'accounts', at: [2, 0], label: 'Accounts database (production)' },
      { key: 'webhook', at: [0, 1], label: 'Public webhook' },
      { key: 'ledger', at: [2, 1], label: 'Core ledger database (production)' },
    ],
    edges: [
      { from: 'browser', to: 'gateway', label: 'HTTPS, user password' },
      { from: 'gateway', to: 'accounts', label: 'SQL' },
      { from: 'webhook', to: 'ledger', label: 'direct write, no authentication' },
    ],
  },
  {
    id: 'data-pipeline',
    name: 'Data pipeline',
    nodes: [
      { key: 'partner', at: [0, 0], label: 'Partner file upload' },
      { key: 'ingest', at: [1, 0], label: 'Ingest worker' },
      { key: 'lake', at: [2, 0], label: 'Data lake with personal data' },
      { key: 'dashboard', at: [2, 1], label: 'Public analytics dashboard' },
    ],
    edges: [
      { from: 'partner', to: 'ingest', label: 'unencrypted FTP' },
      { from: 'ingest', to: 'lake', label: 'nightly batch' },
      { from: 'lake', to: 'dashboard', label: 'raw records' },
    ],
  },
  {
    id: 'field-site',
    name: 'Field site',
    nodes: [
      { key: 'latrines', at: [0, 0], label: 'Latrine block' },
      { key: 'borehole', at: [1, 0], label: 'Borehole (groundwater)' },
      { key: 'tap', at: [1, 1], label: 'Tap stand' },
      { key: 'homes', at: [2, 1], label: 'Households (400 people)' },
    ],
    edges: [
      { from: 'latrines', to: 'borehole', label: '12 metres away' },
      { from: 'borehole', to: 'tap', label: 'chlorinated supply' },
      { from: 'tap', to: 'homes', label: '700 metres walk' },
    ],
  },
];

const W = 200;
const H = 80;
const GAP_X = 160;
const GAP_Y = 140;

/** The template's elements: labelled boxes, then arrows bound to them. */
export function buildTemplate(t: Template, convert: Convert): readonly ExcalidrawElement[] {
  const ids = new Map(t.nodes.map((n) => [n.key, `${t.id}-${n.key}`]));
  const shapes = convert(
    t.nodes.map(
      (n) =>
        ({
          type: 'rectangle',
          id: ids.get(n.key),
          x: n.at[0] * (W + GAP_X),
          y: n.at[1] * (H + GAP_Y),
          width: W,
          height: H,
          roughness: 0,
          strokeWidth: 2,
          roundness: { type: 3 },
          label: { text: n.label, fontSize: 16 },
        }) as ExcalidrawElementSkeleton,
    ),
    { regenerateIds: false },
  );
  const scene = memoryScene(shapes);
  for (const e of t.edges) {
    const from = ids.get(e.from);
    const to = ids.get(e.to);
    if (from && to) addBoundArrow(scene, convert, from, to, e.label);
  }
  return scene.elements;
}
