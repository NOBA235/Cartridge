/**
 * Test helper: builds a tiny, valid text PDF (Helvetica, one text block per
 * page) with a correct cross-reference table. Lines are separated by T*;
 * an empty string in `lines` adds a paragraph gap.
 */
function escapePdfString(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
}

function contentStream(lines: readonly string[]): string {
  const ops = ['BT', '/F1 12 Tf', '14 TL', '72 720 Td'];
  for (const line of lines) {
    if (line === '') ops.push('0 -28 Td');
    else ops.push(`(${escapePdfString(line)}) Tj`, 'T*');
  }
  ops.push('ET');
  return ops.join('\n');
}

export function makeTextPdf(pages: ReadonlyArray<readonly string[]>): Uint8Array {
  const objects: string[] = [];
  const pageIds: number[] = [];
  // 1 catalog, 2 pages, 3 font, then page + content pairs.
  objects[1] = '<< /Type /Catalog /Pages 2 0 R >>';
  objects[3] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>';
  pages.forEach((lines, i) => {
    const pageId = 4 + i * 2;
    const contentId = pageId + 1;
    pageIds.push(pageId);
    const stream = contentStream(lines);
    objects[pageId] =
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents ${contentId} 0 R /Resources << /Font << /F1 3 0 R >> >> >>`;
    objects[contentId] = `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`;
  });
  objects[2] = `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pageIds.length} >>`;

  let out = '%PDF-1.4\n';
  const offsets: number[] = [];
  for (let id = 1; id < objects.length; id++) {
    offsets[id] = out.length;
    out += `${id} 0 obj\n${objects[id]}\nendobj\n`;
  }
  const xref = out.length;
  out += `xref\n0 ${objects.length}\n0000000000 65535 f \n`;
  for (let id = 1; id < objects.length; id++) {
    out += `${String(offsets[id]).padStart(10, '0')} 00000 n \n`;
  }
  out += `trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  // Latin-1 only, so string length equals byte length.
  return Uint8Array.from(out, (c) => c.charCodeAt(0) & 0xff);
}
