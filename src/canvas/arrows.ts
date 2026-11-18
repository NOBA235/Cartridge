/**
 * addBoundArrow(): an arrow properly bound to two existing shapes, so the
 * graph reader counts it as a connection and it follows the shapes when they
 * move. Uses Excalidraw's element-skeleton conversion (checked in its docs and
 * source for 0.18.1): bindings by id are resolved only against elements passed
 * in the same call, so both shapes go in with the arrow, and the converted
 * shapes (now listing the arrow in boundElements) replace the old ones.
 *
 * Excalidraw needs a browser to load, so the converter is passed in; this file
 * imports only its types.
 */
import type { ExcalidrawElement } from '@excalidraw/excalidraw/element/types';
import type { ExcalidrawElementSkeleton } from '@excalidraw/excalidraw/data/transform';

export type Convert = (
  skeleton: ExcalidrawElementSkeleton[],
  opts?: { regenerateIds: boolean },
) => readonly ExcalidrawElement[];

/** A scene held in memory (used to build templates before the canvas opens). */
export function memoryScene(initial: readonly ExcalidrawElement[] = []): SceneApi & {
  elements: readonly ExcalidrawElement[];
} {
  const scene = {
    elements: initial,
    getSceneElementsIncludingDeleted: () => scene.elements,
    updateScene: (s: { elements: readonly ExcalidrawElement[] }) => {
      scene.elements = s.elements;
    },
  };
  return scene;
}

export interface SceneApi {
  getSceneElementsIncludingDeleted(): readonly ExcalidrawElement[];
  updateScene(scene: { elements: readonly ExcalidrawElement[] }): void;
}

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Where a straight arrow from a's border to b's border starts and ends. */
export function arrowGeometry(
  a: Box,
  b: Box,
): { x: number; y: number; width: number; height: number } {
  const ac = { x: a.x + a.width / 2, y: a.y + a.height / 2 };
  const bc = { x: b.x + b.width / 2, y: b.y + b.height / 2 };
  const dx = bc.x - ac.x;
  const dy = bc.y - ac.y;
  // Leave each box at its border along the line between the centres.
  const exit = (box: Box, sx: number, sy: number) => {
    const tx = sx === 0 ? Infinity : box.width / 2 / Math.abs(sx);
    const ty = sy === 0 ? Infinity : box.height / 2 / Math.abs(sy);
    return Math.min(tx, ty);
  };
  const ta = exit(a, dx, dy);
  const tb = exit(b, dx, dy);
  const start = { x: ac.x + dx * ta, y: ac.y + dy * ta };
  const end = { x: bc.x - dx * tb, y: bc.y - dy * tb };
  return { x: start.x, y: start.y, width: end.x - start.x, height: end.y - start.y };
}

let counter = 0;
const newId = () => `arrow-${Date.now().toString(36)}-${(counter++).toString(36)}`;

/** The skeleton for an arrow bound to `from` and `to` (both passed in the same conversion). */
export function boundArrowSkeleton(
  from: ExcalidrawElement,
  to: ExcalidrawElement,
  label?: string,
  id: string = newId(),
): ExcalidrawElementSkeleton {
  const g = arrowGeometry(from, to);
  return {
    type: 'arrow',
    id,
    ...g,
    roughness: 0,
    strokeWidth: 2,
    start: { id: from.id },
    end: { id: to.id },
    ...(label?.trim() ? { label: { text: label.trim() } } : {}),
  } as ExcalidrawElementSkeleton;
}

/** Adds the arrow to the scene; returns its id. */
export function addBoundArrow(
  api: SceneApi,
  convert: Convert,
  fromId: string,
  toId: string,
  label?: string,
): string {
  const elements = api.getSceneElementsIncludingDeleted();
  const from = elements.find((e) => e.id === fromId && !e.isDeleted);
  const to = elements.find((e) => e.id === toId && !e.isDeleted);
  if (!from || !to) throw new Error('Both ends of the arrow must be shapes on the canvas.');
  if (fromId === toId) throw new Error('An arrow needs two different shapes.');
  const skeleton = boundArrowSkeleton(from, to, label);
  const converted = convert(
    [
      from as unknown as ExcalidrawElementSkeleton,
      to as unknown as ExcalidrawElementSkeleton,
      skeleton,
    ],
    { regenerateIds: false },
  );
  const replaced = new Map(converted.map((e) => [e.id, e]));
  const next = elements.map((e) => replaced.get(e.id) ?? e);
  const added = converted.filter((e) => !elements.some((x) => x.id === e.id));
  api.updateScene({ elements: [...next, ...added] });
  return skeleton.id ?? '';
}
