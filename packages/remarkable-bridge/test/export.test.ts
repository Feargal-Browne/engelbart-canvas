import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { PDFArray, PDFDocument, StandardFonts } from 'pdf-lib';
import { openBundle } from '../src/doc/bundle.ts';
import { readDocument } from '../src/document.ts';
import { documentToPdf } from '../src/export/pdf.ts';
import { UNITS_PER_POINT } from '../src/geometry.ts';
import { createFolderSource } from '../src/sources/folder.ts';

const FIXTURES = path.join(import.meta.dirname, 'fixtures');
const DOC = '0f1e2d3c-4b5a-4968-8778-a6b5c4d3e2f1';
const P = ['11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222', '33333333-3333-4333-8333-333333333333'];
const inkPage = fs.readFileSync(path.join(FIXTURES, 'pages', 'Lines_v2.rm'));

/** A PDF of `sizes` pages, each saying its own number. */
async function pdfOf(sizes: [number, number][]): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  sizes.forEach((size, i) => pdf.addPage(size).drawText(`Page ${i + 1}`, { x: 72, y: size[1] - 72, size: 12, font }));
  return pdf.save();
}

/** A PDF document bundle in memory: `pages` its cPages, `ink` the page ids that have a .rm. */
function bundleOf(source: Uint8Array, pages: object[], ink: string[]) {
  const files = new Map<string, Uint8Array>([
    [`${DOC}.metadata`, new TextEncoder().encode(JSON.stringify({ visibleName: 'Paper', type: 'DocumentType', parent: '' }))],
    [`${DOC}.content`, new TextEncoder().encode(JSON.stringify({ fileType: 'pdf', formatVersion: 2, cPages: { pages } }))],
    [`${DOC}.pdf`, source],
    ...ink.map((id): [string, Uint8Array] => [`${DOC}/${id}.rm`, inkPage]),
  ]);
  return openBundle(DOC, async (name) => files.get(name) ?? null);
}
const lww = (value: unknown) => ({ timestamp: '1:1', value });

test('a notebook becomes one PDF page per page, at the tablet scale', async () => {
  const source = createFolderSource(path.join(FIXTURES, 'xochitl'));
  const [entry] = await source.list();
  const doc = await readDocument(await source.open(entry!.id));
  const pdf = await PDFDocument.load(await documentToPdf(doc));
  assert.equal(pdf.getPageCount(), 12);
  const { width, height } = pdf.getPage(0).getSize();
  assert.ok(Math.abs(width - 1404 / UNITS_PER_POINT) < 0.01, `width ${width}`);
  assert.ok(height >= 1872 / UNITS_PER_POINT - 0.01, `height ${height}`);
  assert.equal(pdf.getTitle(), 'Test');
});

test('a PDF in its own order is drawn on in place: same pages, ink added', async () => {
  const source = await pdfOf([[612, 792], [612, 792], [612, 792]]);
  const bundle = await bundleOf(source, P.map((id, i) => ({ id, idx: lww(`b${'abc'[i]}`), redir: lww(i) })), [P[0]!]);
  const out = await documentToPdf(await readDocument(bundle), { source: await bundle.source() });
  const pdf = await PDFDocument.load(out);
  assert.equal(pdf.getPageCount(), 3);
  assert.ok(out.length > source.length, 'the ink is in it');
});

test('pages moved and inserted on the tablet come out in the tablet order', async () => {
  // The PDF's pages are told apart by size. Tablet order: PDF page 3, an inserted page, PDF page 1; page 2 deleted.
  const source = await pdfOf([[600, 800], [500, 700], [400, 600]]);
  const pages = [
    { id: P[0], idx: lww('ba'), redir: lww(2) },
    { id: P[1], idx: lww('bb') },
    { id: P[2], idx: lww('bc'), redir: lww(0) },
    { id: '44444444-4444-4444-8444-444444444444', idx: lww('bd'), redir: lww(1), deleted: lww(1) },
  ];
  const bundle = await bundleOf(source, pages, [P[1]!]);
  const pdf = await PDFDocument.load(await documentToPdf(await readDocument(bundle), { source: await bundle.source() }));
  assert.deepEqual(pdf.getPages().map((p) => [p.getWidth(), p.getHeight()]), [[400, 600], [400, 600], [600, 800]]);
});

test('order source: the PDF’s pages keep their numbers, with their ink; inserted pages come after', async () => {
  // Tablet order as above: PDF page 3 (inked), an inserted page (inked), PDF page 1; page 2 deleted on the tablet.
  const source = await pdfOf([[600, 800], [500, 700], [400, 600]]);
  const pages = [
    { id: P[0], idx: lww('ba'), redir: lww(2) },
    { id: P[1], idx: lww('bb') },
    { id: P[2], idx: lww('bc'), redir: lww(0) },
    { id: '44444444-4444-4444-8444-444444444444', idx: lww('bd'), redir: lww(1), deleted: lww(1) },
  ];
  const bundle = await bundleOf(source, pages, [P[0]!, P[1]!]);
  const doc = await readDocument(bundle);
  const pdf = await PDFDocument.load(await documentToPdf(doc, { source: await bundle.source(), order: 'source' }));
  assert.deepEqual(pdf.getPages().map((p) => [p.getWidth(), p.getHeight()]), [[600, 800], [500, 700], [400, 600], [400, 600]],
    'pages 1–3 where they were (page 2 too), then the inserted page, the size of the one before it on the tablet');
  const plain = await PDFDocument.load(source);
  const streams = (d: PDFDocument, i: number) => { const c = d.getPage(i).node.Contents(); return c instanceof PDFArray ? c.size() : c ? 1 : 0; };
  assert.ok(streams(pdf, 2) > streams(plain, 2), 'page 3 has its ink drawn on');
  assert.equal(streams(pdf, 1), streams(plain, 1), 'page 2, deleted on the tablet, is as it was');
  assert.ok(streams(pdf, 3) > 0, 'the inserted page has its ink');
});

test('a PDF that cannot be opened still gives the ink, on blank pages', async () => {
  const bundle = await bundleOf(new TextEncoder().encode('%PDF-1.7 broken'), [{ id: P[0], idx: lww('ba'), redir: lww(0) }], [P[0]!]);
  const pdf = await PDFDocument.load(await documentToPdf(await readDocument(bundle), { source: await bundle.source() }));
  assert.equal(pdf.getPageCount(), 1);
});
