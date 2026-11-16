/**
 * Cartridge JSON export and import. Imported files are checked with zod
 * before anything uses them. An imported cartridge gets a new id so it can
 * never overwrite one already on this device.
 */
import { z } from 'zod';
import { CartridgeSchema, type Cartridge } from './types';

export const EXPORT_FORMAT = 'cartridge' as const;
export const EXPORT_FORMAT_VERSION = 1;

const ExportFile = z.object({
  format: z.literal(EXPORT_FORMAT),
  formatVersion: z.literal(EXPORT_FORMAT_VERSION),
  cartridge: CartridgeSchema,
});

export class ImportError extends Error {
  override readonly name = 'ImportError';
}

export function exportCartridgeJson(c: Cartridge): string {
  return `${JSON.stringify({ format: EXPORT_FORMAT, formatVersion: EXPORT_FORMAT_VERSION, cartridge: c }, null, 2)}\n`;
}

export function exportFileName(c: Cartridge): string {
  const slug =
    c.name
      .toLowerCase()
      .replace(/\.[a-z0-9]+$/, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'cartridge';
  return `${slug}-v${c.version}.cartridge.json`;
}

export function importCartridgeJson(
  text: string,
  options: { newId?: () => string; now?: Date } = {},
): Cartridge {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new ImportError('This file is not valid JSON.');
  }
  const parsed = ExportFile.safeParse(json);
  if (!parsed.success) {
    const bare = CartridgeSchema.safeParse(json);
    if (!bare.success) {
      const issue = parsed.error.issues[0];
      throw new ImportError(
        `This is not a cartridge file${issue ? ` (${issue.path.join('.') || 'file'}: ${issue.message})` : ''}.`,
      );
    }
    return withNewId(bare.data, options);
  }
  return withNewId(parsed.data.cartridge, options);
}

function withNewId(c: Cartridge, options: { newId?: () => string; now?: Date }): Cartridge {
  const at = (options.now ?? new Date()).toISOString().slice(0, 10);
  return {
    ...c,
    id: options.newId?.() ?? `ctg-${crypto.randomUUID()}`,
    changelog: [...c.changelog, `Imported from a file on ${at}.`],
  };
}
