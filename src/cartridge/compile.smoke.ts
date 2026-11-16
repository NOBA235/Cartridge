/**
 * Real end-to-end 'Make the cartridge' run: real document, real cloud
 * (Firebase AI Logic with App Check), real checks. Not part of `npm test`.
 *
 *   $env:SMOKE_SOURCE = "C:\path\to\standard.pdf"   # or an https:// URL, or .md / .txt
 *   $env:SMOKE_LICENCE = "CC BY-SA 4.0"             # the document's licence
 *   $env:SMOKE_SECTIONS = "2"                       # optional: sections to read (default 2, 'all' for every one)
 *   npm run smoke:compile
 *
 * Needs .env.local with Firebase config and VITE_APPCHECK_DEBUG_TOKEN set to a
 * registered debug token. Writes the cartridge JSON to the OS temp folder.
 */
import { readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, extname, join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { cloudJson } from '@/ai/cloud';
import { egressLog } from '@/telemetry/egress';
import { exportCartridgeJson, exportFileName } from './cartridgeIO';
import { compileCartridge, CompileError } from './compile';
import { extractPdfPages, type PdfLibLike } from './pdf/extractPdf';
import { buildDraftFromPages, buildDraftFromText, confirmSource } from './source';
import { verifyQuote } from './verifyQuote';

const realLog = console.log.bind(console);
beforeAll(() => {
  // The App Check SDK prints the debug token in debug mode; keep it out of logs.
  vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
    if (args.some((a) => typeof a === 'string' && /debug token/i.test(a))) return;
    realLog(...args);
  });
});
afterAll(() => vi.restoreAllMocks());

async function readBytes(location: string): Promise<Uint8Array> {
  if (/^https:\/\//i.test(location)) {
    const res = await fetch(location);
    if (!res.ok) throw new Error(`Download failed: HTTP ${res.status}`);
    return new Uint8Array(await res.arrayBuffer());
  }
  return new Uint8Array(await readFile(location));
}

async function pdfLib(): Promise<PdfLibLike> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  pdfjs.GlobalWorkerOptions.workerSrc = new URL(
    '../../node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs',
    import.meta.url,
  ).href;
  return pdfjs as unknown as PdfLibLike;
}

describe('real compile (smoke)', () => {
  it('makes a cartridge whose every quote verifies', async () => {
    const location = process.env.SMOKE_SOURCE;
    const licence = process.env.SMOKE_LICENCE;
    if (!location || !licence) {
      throw new Error(
        'Set SMOKE_SOURCE (file path or https URL) and SMOKE_LICENCE. See the comment at the top of this file.',
      );
    }
    if (!import.meta.env.VITE_APPCHECK_DEBUG_TOKEN) {
      throw new Error(
        'Set VITE_APPCHECK_DEBUG_TOKEN in .env.local to a registered App Check debug token.',
      );
    }
    const limitRaw = process.env.SMOKE_SECTIONS ?? '2';
    const sectionLimit = limitRaw === 'all' ? undefined : Number(limitRaw);

    const name = basename(new URL(location, 'file:///').pathname) || 'source';
    const bytes = await readBytes(location);
    const ext = extname(name).toLowerCase();
    const draft =
      ext === '.pdf'
        ? await buildDraftFromPages(name, await extractPdfPages(await pdfLib(), bytes))
        : await buildDraftFromText(
            name,
            new TextDecoder().decode(bytes),
            ext === '.md' ? 'markdown' : 'text',
          );
    const source = confirmSource(draft, licence);
    realLog(
      `[smoke] source ${name}: ${draft.charCount} chars, ${draft.pageCount ?? '-'} pages, warnings ${draft.warnings.length}`,
    );

    const started = Date.now();
    try {
      const res = await compileCartridge(source, {
        cloud: cloudJson,
        options: sectionLimit !== undefined ? { sectionLimit } : {},
        onProgress: (p) => {
          if (p.step === 'reading')
            realLog(`[smoke] reading section ${p.section} of ${p.sectionCount}`);
          if (p.step === 'checking')
            realLog(`[smoke] verified ${p.verified} of ${p.checked} quotes`);
          if (p.step === 'repairing') realLog(`[smoke] asking again for ${p.count} quotes`);
        },
      });
      const out = join(tmpdir(), exportFileName(res.cartridge));
      await writeFile(out, exportCartridgeJson(res.cartridge));
      realLog(
        `[smoke] ${JSON.stringify(res.stats)} in ${Math.round((Date.now() - started) / 1000)} s`,
      );
      realLog(
        `[smoke] cloud calls ${egressLog.entries().filter((e) => e.kind === 'cloud-call').length}, bytes sent ${egressLog.totalBytesSent()}`,
      );
      for (const r of res.cartridge.rules.slice(0, 5)) {
        realLog(
          `[smoke] ${r.id} [${r.severity}] ${r.title} | p.${r.source.page ?? '-'} | "${r.source.quote.slice(0, 90)}"`,
        );
      }
      const reasons = res.dropped.reduce<Record<string, number>>(
        (m, d) => ({ ...m, [d.reason]: (m[d.reason] ?? 0) + 1 }),
        {},
      );
      realLog(
        `[smoke] left out: ${JSON.stringify(reasons)}; failed sections: ${res.failedSections.length}; notes: ${res.notes.length}`,
      );
      realLog(`[smoke] cartridge written to ${out}`);

      expect(res.cartridge.rules.length).toBeGreaterThan(0);
      for (const r of res.cartridge.rules)
        expect(verifyQuote(r.source.quote, source).ok).toBe(true);
    } catch (e) {
      if (e instanceof CompileError) realLog(`[smoke] compile stopped: ${e.code}: ${e.message}`);
      throw e;
    }
  }, 1_800_000);
});
