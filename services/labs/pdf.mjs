import { deflateSync } from 'node:zlib';

// Core PDF fonts need no runtime service or dependency. Preserve unencodable codepoints
// as explicit Unicode escapes, and embed the untouched UTF-8 report for exact fidelity.
function printable(value) {
  const winAnsi = new Map([[0x20ac, 0x80], [0x201a, 0x82], [0x0192, 0x83], [0x201e, 0x84], [0x2026, 0x85], [0x2020, 0x86], [0x2021, 0x87], [0x02c6, 0x88], [0x2030, 0x89], [0x0160, 0x8a], [0x2039, 0x8b], [0x0152, 0x8c], [0x017d, 0x8e], [0x2018, 0x91], [0x2019, 0x92], [0x201c, 0x93], [0x201d, 0x94], [0x2022, 0x95], [0x2013, 0x96], [0x2014, 0x97], [0x02dc, 0x98], [0x2122, 0x99], [0x0161, 0x9a], [0x203a, 0x9b], [0x0153, 0x9c], [0x017e, 0x9e], [0x0178, 0x9f]]);
  let output = '';
  for (const char of String(value)) {
    const cp = char.codePointAt(0);
    if (cp === 9) output += '    ';
    else if (cp === 10) output += '\n';
    else if ((cp >= 32 && cp <= 126) || (cp >= 160 && cp <= 255)) output += char;
    else if (winAnsi.has(cp)) output += String.fromCharCode(winAnsi.get(cp));
    else if (cp > 31) output += cp <= 0xffff ? `\\u${cp.toString(16).padStart(4, '0')}` : `\\u{${cp.toString(16)}}`;
  }
  return output;
}
function escaped(text) { return text.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)'); }
function pdfString(text) { return escaped(printable(text)); }
function wrap(text, width = 93) {
  const lines = [];
  for (const original of printable(text).replace(/\r\n?/g, '\n').split('\n')) {
    if (!original.length) { lines.push(''); continue; }
    let value = original;
    while (value.length > width) {
      let at = value.lastIndexOf(' ', width); if (at < width / 2) at = width;
      lines.push(value.slice(0, at)); value = value.slice(at).replace(/^ /, '');
    }
    lines.push(value);
  }
  return lines;
}
/** Paginated, searchable PDF with no HTML evaluation and the original report attached. */
export function createReportPdf(report) {
  const title = 'UNLOCK Labs / accepted AI audit report';
  const header = [title, '', `Review: ${report.complete ? 'Completed accepted review' : 'Accepted report; overall job incomplete'}`,
    `Commit: ${report.commit}`, `Job ID: ${report.jobId}`, `Date: ${report.date}`, `Repository: ${report.repoUrl}`,
    `Scope: ${(report.scope || []).join(', ') || 'See accepted report'}`, `Report SHA-256: ${report.reportHash}`, '',
    'This AI review is not a security guarantee. Findings may be incomplete or incorrect.',
    'The original UTF-8 report.md is embedded. Unsupported font characters use Unicode escapes.', '', 'Accepted report.md', ''];
  const lines = [...wrap(header.join('\n')), ...wrap(report.markdown)];
  const perPage = 58; const pages = [];
  for (let at = 0; at < lines.length; at += perPage) pages.push(lines.slice(at, at + perPage));
  const objects = [null];
  const add = value => { objects.push(value); return objects.length - 1; };
  const catalogId = add(''); const pagesId = add('');
  const fontId = add('<< /Type /Font /Subtype /Type1 /BaseFont /Courier /Encoding /WinAnsiEncoding >>');
  const pageIds = [];
  for (let i = 0; i < pages.length; i++) {
    const commands = ['BT', `/F1 9.5 Tf`, '12 TL', '40 800 Td', ...pages[i].flatMap((line, index) => [index ? 'T*' : '', `(${escaped(line)}) Tj`]), 'ET',
      'BT', '/F1 8 Tf', '40 26 Td', `(UNLOCK Labs | ${pdfString(report.jobId)} | Page ${i + 1} of ${pages.length}) Tj`, 'ET'].filter(Boolean).join('\n');
    const data = deflateSync(Buffer.from(commands, 'latin1'));
    const streamId = add(Buffer.concat([Buffer.from(`<< /Length ${data.length} /Filter /FlateDecode >>\nstream\n`), data, Buffer.from('\nendstream')]));
    pageIds.push(add(`<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 ${fontId} 0 R >> >> /Contents ${streamId} 0 R >>`));
  }
  const original = Buffer.from(report.markdown, 'utf8'); const compressed = deflateSync(original);
  const attachmentId = add(Buffer.concat([Buffer.from(`<< /Type /EmbeddedFile /Subtype /text#2Fmarkdown /Length ${compressed.length} /Filter /FlateDecode /Params << /Size ${original.length} >> >>\nstream\n`), compressed, Buffer.from('\nendstream')]));
  const fileId = add(`<< /Type /Filespec /F (report.md) /UF (report.md) /Desc (Original accepted UTF-8 report) /EF << /F ${attachmentId} 0 R >> >>`);
  objects[catalogId] = `<< /Type /Catalog /Pages ${pagesId} 0 R /Names << /EmbeddedFiles << /Names [(report.md) ${fileId} 0 R] >> >> >>`;
  objects[pagesId] = `<< /Type /Pages /Count ${pageIds.length} /Kids [${pageIds.map(id => `${id} 0 R`).join(' ')}] >>`;
  const infoId = add(`<< /Title (${pdfString(title)}) /Subject (Commit ${pdfString(report.commit)}, Job ${pdfString(report.jobId)}) /Creator (UNLOCK Labs) >>`);
  const buffers = [Buffer.from('%PDF-1.7\n%\xe2\xe3\xcf\xd3\n', 'latin1')]; const offsets = [0]; let length = buffers[0].length;
  for (let i = 1; i < objects.length; i++) {
    offsets[i] = length; const object = Buffer.concat([Buffer.from(`${i} 0 obj\n`), Buffer.isBuffer(objects[i]) ? objects[i] : Buffer.from(objects[i], 'latin1'), Buffer.from('\nendobj\n')]);
    buffers.push(object); length += object.length;
  }
  const xrefAt = length;
  buffers.push(Buffer.from(`xref\n0 ${objects.length}\n0000000000 65535 f \n${offsets.slice(1).map(offset => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size ${objects.length} /Root ${catalogId} 0 R /Info ${infoId} 0 R >>\nstartxref\n${xrefAt}\n%%EOF\n`, 'latin1'));
  return Buffer.concat(buffers);
}
