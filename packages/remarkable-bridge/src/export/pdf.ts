// A document as one PDF, with the ink drawn in as vectors.
//
// A PDF or EPUB-from-PDF document: its own pages, in the tablet's order (pages moved, inserted or deleted on the tablet
// moved, inserted or left out here), each with its ink and highlights over it at the tablet's fixed scale
// (../geometry.ts). When the pages are the PDF's own in their own order, which is nearly always, the PDF is written on
// in place, so its links, outline and text stay as they were. With `order: 'source'` the PDF's pages stay in their own
// order and keep their numbers (pages inserted on the tablet come after them), for a PDF marked elsewhere by page.
//
// A notebook: one PDF page per tablet page, the page's own size at 227 units to the point (445×594 pt for a reMarkable
// 2, 514×685 for a Paper Pro), longer when the ink runs further down. Typed text is set in Helvetica, so it is real,
// searchable text; characters Helvetica lacks are left out of the PDF (the text extraction keeps them).

import {
  closePath, concatTransformationMatrix, degrees, fill, LineCapStyle, LineJoinStyle, lineTo, moveTo, PDFDocument, PDFName,
  popGraphicsState, pushGraphicsState, setFillingRgbColor, setGraphicsState, setLineCap, setLineJoin, setLineWidth,
  setStrokingRgbColor, StandardFonts, stroke as strokePath, type PDFFont, type PDFOperator, type PDFPage,
} from 'pdf-lib';
import type { ReadDocument } from '../document.ts';
import { pdfMapping, UNITS_PER_POINT, type PdfMapping } from '../geometry.ts';
import type { Rgba } from '../rm/codes.ts';
import { layoutText } from '../rm/layout.ts';
import { RM2_PAGE, type Page } from '../rm/page.ts';
import { lookOf } from '../render/pens.ts';
import { strokeRuns } from '../render/runs.ts';
import { MACHINE_READ, type Handwriting, type HandwrittenLine } from '../ocr/handwriting.ts';

export interface PdfOptions {
  /** The document's PDF (bundle.source()). Without it, a PDF document's ink is drawn on blank pages. */
  source?: Uint8Array | null;
  /**
   * Handwriting as read (../ocr/handwriting.ts), laid over the ink as invisible text: the PDF can then be searched, and
   * its text read by anything that reads PDFs, as a scanned page made searchable is.
   */
  handwriting?: Handwriting;
  /** The paper's colour, for eraser strokes on older pages. Default white. */
  paper?: Rgba;
  /**
   * A PDF document's page order. 'tablet' (the default): the tablet's, as above. 'source': the PDF's own pages in their
   * own order, each with the ink of the tablet page that shows it, then the pages inserted on the tablet. Every PDF
   * page keeps its number, so marks made on the same PDF elsewhere, kept by page number, still land on their page.
   */
  order?: 'tablet' | 'source';
}

const WHITE: Rgba = { r: 255, g: 255, b: 255, a: 1 };

export async function documentToPdf(doc: ReadDocument, options: PdfOptions = {}): Promise<Uint8Array> {
  const source = doc.bundle.content.fileType === 'pdf' && options.source ? await loadOrNull(options.source) : null;
  const paper = options.paper ?? WHITE;
  if (source) {
    const count = source.getPageCount();
    const own = doc.pages.length === count && doc.pages.every(({ ref }, i) => ref.sourcePage === i);
    if (own) {
      const pages = source.getPages();
      const font = await fontFor(source, doc.pages, options.handwriting);
      doc.pages.forEach(({ ref, page }, i) => { if (page) drawOnPdfPage(source, pages[i]!, page, font, paper, options.handwriting?.get(ref.id)); });
      return source.save();
    }
    const onPdf = (n: number | null): n is number => n !== null && Number.isInteger(n) && n >= 0 && n < count;
    if (options.order === 'source') return inSourceOrder(source, doc, onPdf, paper, options.handwriting);
    const out = await PDFDocument.create();
    const wanted = doc.pages.map(({ ref }) => ref.sourcePage).filter(onPdf);
    const copied = await out.copyPages(source, wanted);
    const font = await fontFor(out, doc.pages, options.handwriting);
    let next = 0;
    let lastSize: [number, number] = [RM2_PAGE.width / UNITS_PER_POINT, RM2_PAGE.height / UNITS_PER_POINT];
    for (const { ref, page } of doc.pages) {
      let pdfPage: PDFPage;
      if (onPdf(ref.sourcePage)) {
        pdfPage = out.addPage(copied[next++]!);
        const box = pdfPage.getCropBox();
        lastSize = [box.width, box.height];
      } else {
        pdfPage = out.addPage(lastSize); // inserted on the tablet: a blank page like the one before it
      }
      if (page) drawOnPdfPage(out, pdfPage, page, font, paper, options.handwriting?.get(ref.id));
    }
    return out.save();
  }

  const out = await PDFDocument.create();
  out.setTitle(doc.bundle.metadata.name);
  const font = await fontFor(out, doc.pages, options.handwriting);
  for (const { ref, page } of doc.pages) {
    if (!page) {
      out.addPage([RM2_PAGE.width / UNITS_PER_POINT, RM2_PAGE.height / UNITS_PER_POINT]);
      continue;
    }
    const height = Math.max(page.height, contentBottom(page) + 40);
    const W = page.width / UNITS_PER_POINT, H = height / UNITS_PER_POINT;
    const pdfPage = out.addPage([W, H]);
    draw(out, pdfPage, page, pdfMapping({ x0: 0, y0: 0, x1: W, y1: H }), font, paper, options.handwriting?.get(ref.id));
  }
  return out.save();
}

/**
 * order 'source': the PDF written on in place, every page where it was. A page the tablet shows is drawn on with that
 * page's ink (a page shown twice: its first showing, and a copy of it with the second after the PDF's pages); one
 * deleted on the tablet stays, with no ink; one inserted on the tablet comes after the PDF's pages, in the tablet's
 * order, the size of the page before it there.
 */
async function inSourceOrder(source: PDFDocument, doc: ReadDocument, onPdf: (n: number | null) => n is number, paper: Rgba, handwriting?: Handwriting): Promise<Uint8Array> {
  const pages = source.getPages();
  // Second showings copied first, before any page has ink on it.
  const seen = new Set<number>();
  const again = doc.pages.map(({ ref }) => (onPdf(ref.sourcePage) && (seen.has(ref.sourcePage) || !seen.add(ref.sourcePage)) ? ref.sourcePage : null));
  const copies = await source.copyPages(source, again.filter((n): n is number => n !== null));
  const font = await fontFor(source, doc.pages, handwriting);
  let next = 0;
  let lastSize: [number, number] = [RM2_PAGE.width / UNITS_PER_POINT, RM2_PAGE.height / UNITS_PER_POINT];
  for (const [i, { ref, page }] of doc.pages.entries()) {
    let pdfPage: PDFPage;
    if (onPdf(ref.sourcePage)) {
      const own = pages[ref.sourcePage]!;
      const box = own.getCropBox();
      lastSize = [box.width, box.height];
      if (again[i] === null) {
        if (page) drawOnPdfPage(source, own, page, font, paper, handwriting?.get(ref.id));
        continue;
      }
      pdfPage = source.addPage(copies[next++]!);
    } else {
      pdfPage = source.addPage(lastSize);
    }
    if (page) drawOnPdfPage(source, pdfPage, page, font, paper, handwriting?.get(ref.id));
  }
  return source.save();
}

/** The PDF, or null when pdf-lib cannot open it (encrypted, damaged): its ink then goes on blank pages. */
async function loadOrNull(bytes: Uint8Array): Promise<PDFDocument | null> {
  try {
    const pdf = await PDFDocument.load(bytes, { updateMetadata: false });
    pdf.getPages(); // pdf-lib opens some broken files and fails only once their pages are asked for
    return pdf;
  } catch {
    return null;
  }
}

/** Helvetica, embedded only when some page has typed text to set or handwriting read. */
async function fontFor(pdf: PDFDocument, pages: ReadDocument['pages'], handwriting?: Handwriting): Promise<PDFFont | null> {
  const text = pages.some(({ ref, page }) => page?.text?.paragraphs.some((p) => p.text) || (handwriting?.get(ref.id)?.length ?? 0) > 0);
  return text ? pdf.embedFont(StandardFonts.Helvetica) : null;
}

function drawOnPdfPage(pdf: PDFDocument, pdfPage: PDFPage, page: Page, font: PDFFont | null, paper: Rgba, written: HandwrittenLine[] = []): void {
  const box = pdfPage.getCropBox();
  const rotate = pdfPage.getRotation().angle;
  draw(pdf, pdfPage, page, pdfMapping({ x0: box.x, y0: box.y, x1: box.x + box.width, y1: box.y + box.height }, undefined, rotate), font, paper, written, rotate);
}

/** The page's highlights, ink and typed text onto `pdfPage`, through `map`; its handwriting as read, invisible. */
function draw(pdf: PDFDocument, pdfPage: PDFPage, page: Page, map: PdfMapping, font: PDFFont | null, paper: Rgba, written: HandwrittenLine[] = [], rotate = 0): void {
  // Text on a page shown turned (/Rotate) is turned with it, so it reads upright as the page is shown.
  const turned = rotate % 360 ? { rotate: degrees(rotate) } : {};
  const states = new Map<string, PDFName>();
  const state = (alpha: number, multiply: boolean): PDFName | null => {
    if (alpha >= 1 && !multiply) return null;
    const key = `${alpha.toFixed(3)}:${multiply}`;
    let name = states.get(key);
    if (!name) {
      const dict = pdf.context.obj({ Type: 'ExtGState', CA: alpha, ca: alpha, ...(multiply ? { BM: 'Multiply' } : {}) });
      name = pdfPage.node.newExtGState('RMGS', dict);
      states.set(key, name);
    }
    return name;
  };
  const visible = (layer: number) => page.layers[layer]?.visible !== false;
  const ops: PDFOperator[] = [pushGraphicsState(), concatTransformationMatrix(...map.matrix), setLineJoin(LineJoinStyle.Round)];

  for (const h of page.highlights) {
    if (!visible(h.layer) || h.rects.length === 0) continue;
    ops.push(pushGraphicsState());
    const gs = state(h.color.a, true);
    if (gs) ops.push(setGraphicsState(gs));
    ops.push(setFillingRgbColor(h.color.r / 255, h.color.g / 255, h.color.b / 255));
    for (const r of h.rects) ops.push(moveTo(r.x, r.y), lineTo(r.x + r.w, r.y), lineTo(r.x + r.w, r.y + r.h), lineTo(r.x, r.y + r.h), closePath());
    ops.push(fill(), popGraphicsState());
  }

  for (const s of page.strokes) {
    if (!visible(s.layer)) continue;
    const look = lookOf(s);
    if (look.hidden || s.points.count === 0) continue;
    const p = s.points.decode();
    const color = look.erase ? paper : s.color;
    ops.push(pushGraphicsState(), setStrokingRgbColor(color.r / 255, color.g / 255, color.b / 255));
    ops.push(setLineCap(look.cap === 'butt' ? LineCapStyle.Butt : look.cap === 'square' ? LineCapStyle.Projecting : LineCapStyle.Round));
    let current = '';
    for (const run of strokeRuns(s, p, look)) {
      const alpha = look.opacity * (look.erase ? 1 : color.a) * run.opacity;
      const key = `${alpha}`;
      if (key !== current) {
        const gs = state(alpha, look.multiply);
        if (gs) ops.push(setGraphicsState(gs));
        current = key;
      }
      ops.push(setLineWidth(run.width), moveTo(p.x[run.from]! + s.dx, p.y[run.from]! + s.dy));
      // A dot (one point) is a zero-length line, which a round cap draws as a dot.
      if (run.to === run.from) ops.push(lineTo(p.x[run.from]! + s.dx + 0.01, p.y[run.from]! + s.dy));
      for (let i = run.from + 1; i <= run.to; i++) ops.push(lineTo(p.x[i]! + s.dx, p.y[i]! + s.dy));
      ops.push(strokePath());
    }
    ops.push(popGraphicsState());
  }
  ops.push(popGraphicsState());
  // A heavily inked page is hundreds of thousands of operators: more than one call's arguments can hold.
  for (let i = 0; i < ops.length; i += 10_000) pdfPage.pushOperators(...ops.slice(i, i + 10_000));

  if (font && page.text) {
    const k = UNITS_PER_POINT;
    for (const line of layoutText(page.text).lines) {
      const text = `${line.marker ? `${line.marker} ` : ''}${line.spans.map((s) => s.text).join('')}`;
      const safe = encodable(font, text);
      if (!safe.trim()) continue;
      const [X, Y] = map.toPdf(line.x - (line.marker ? 36 : 0), line.baseline);
      pdfPage.drawText(safe, { x: X, y: Y, size: line.fontSize / k, font, ...turned });
    }
  }
  if (font && written.length) {
    // First, where the page's handwriting begins: what reads the PDF's text (search, Bart) is told it was read by
    // machine, as the Markdown says it.
    const [LX, LY] = map.toPdf(Math.min(...written.map((l) => l.x)), Math.min(...written.map((l) => l.y)));
    pdfPage.drawText(encodable(font, MACHINE_READ), { x: LX, y: LY, size: 4, font, opacity: 0, ...turned });
    // Each line at the foot of its box, about as tall: a selection of it lands on the ink it was read from.
    for (const line of written) {
      const safe = encodable(font, line.text);
      if (!safe.trim()) continue;
      const size = Math.max(3, (line.h / UNITS_PER_POINT) * 0.75);
      const [X, Y] = map.toPdf(line.x, line.y + line.h * 0.8); // the baseline, in the page's shown frame
      pdfPage.drawText(safe, { x: X, y: Y, size, font, opacity: 0, ...turned });
    }
  }
}

/** The lowest point any ink or highlight reaches, page units. */
function contentBottom(page: Page): number {
  let bottom = 0;
  for (const s of page.strokes) bottom = Math.max(bottom, s.points.bounds().maxY + s.dy);
  for (const h of page.highlights) for (const r of h.rects) bottom = Math.max(bottom, r.y + r.h);
  return bottom;
}

/** `text` less the characters `font` cannot set (Helvetica covers Western European text). */
function encodable(font: PDFFont, text: string): string {
  let out = '';
  for (const ch of text) {
    try {
      font.encodeText(ch);
      out += ch;
    } catch {
      // not in the font's encoding
    }
  }
  return out;
}
