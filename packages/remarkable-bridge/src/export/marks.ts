// Highlights made somewhere else drawn onto a PDF's pages, so they show wherever the PDF is read: on the tablet, for one
// sent to it. Each is a rectangle of colour over the text, multiplied in like a highlighter, in the page's content (the
// reMarkable app shows a PDF's pages, not its annotations).
//
// A rectangle is given in the page as it is shown: its crop box, turned by its /Rotate, with x and y from its top-left
// corner, as fractions of its shown width (so a page drawn at any zoom gives the same numbers). That is how a viewer
// built on pdf.js measures a selection.

import { closePath, fill, lineTo, moveTo, PDFDocument, popGraphicsState, pushGraphicsState, setFillingRgbColor, setGraphicsState, type PDFPage } from 'pdf-lib';
import type { Rgba } from '../rm/codes.ts';

export interface ShownRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface PageHighlights {
  /** The page, from 0. */
  page: number;
  rects: ShownRect[];
}

export interface HighlightOptions {
  /** The colour, and how strong (`a`). Default a light blue. */
  color?: Rgba;
  /** The share of each rectangle's height drawn, centred on it (a highlighter is not as tall as the line). Default 0.7. */
  band?: number;
}

const BLUE: Rgba = { r: 0, g: 112, b: 243, a: 0.28 };

/**
 * `highlights` drawn onto the PDF `bytes`. → the new PDF; `bytes` itself when there is nothing to draw, or when the PDF
 * cannot be opened (then it goes as it is). Rectangles on pages it does not have, or not finite, are left out.
 */
export async function drawHighlights(bytes: Uint8Array, highlights: PageHighlights[], options: HighlightOptions = {}): Promise<Uint8Array> {
  const usable = (r: ShownRect) => [r.x, r.y, r.w, r.h].every(Number.isFinite) && r.w > 0 && r.h > 0;
  const wanted = highlights.filter((h) => Number.isInteger(h.page) && h.page >= 0 && h.rects.some(usable));
  if (!wanted.length) return bytes;
  let pdf: PDFDocument;
  try {
    pdf = await PDFDocument.load(bytes, { updateMetadata: false });
  } catch {
    return bytes;
  }
  const pages = pdf.getPages();
  const color = options.color ?? BLUE;
  const band = Math.min(1, Math.max(0.05, options.band ?? 0.7));
  let drew = false;
  for (const { page, rects } of wanted) {
    const pdfPage = pages[page];
    if (!pdfPage) continue;
    const corners = shownToPdf(pdfPage);
    const gs = pdfPage.node.newExtGState('EBHL', pdf.context.obj({ Type: 'ExtGState', CA: color.a, ca: color.a, BM: 'Multiply' }));
    const ops = [pushGraphicsState(), setGraphicsState(gs), setFillingRgbColor(color.r / 255, color.g / 255, color.b / 255)];
    for (const r of rects.filter(usable)) {
      const top = r.y + (r.h * (1 - band)) / 2, bottom = top + r.h * band;
      const points = [corners(r.x, top), corners(r.x + r.w, top), corners(r.x + r.w, bottom), corners(r.x, bottom)];
      ops.push(moveTo(...points[0]!), lineTo(...points[1]!), lineTo(...points[2]!), lineTo(...points[3]!), closePath());
    }
    ops.push(fill(), popGraphicsState());
    pdfPage.pushOperators(...ops);
    drew = true;
  }
  return drew ? pdf.save() : bytes;
}

/**
 * A point of page `p` as it is shown (fractions of its shown width, from its top-left) → PDF user space. As pdf.js turns
 * a page by its /Rotate: 90 is a quarter turn clockwise.
 */
export function shownToPdf(p: PDFPage): (fx: number, fy: number) => [number, number] {
  const box = p.getCropBox();
  const { x: bx, y: by, width: bw, height: bh } = box;
  const rotate = ((Math.round(p.getRotation().angle / 90) * 90) % 360 + 360) % 360;
  const shownW = rotate % 180 ? bh : bw;
  return (fx, fy) => {
    const sx = fx * shownW, sy = fy * shownW;
    if (rotate === 90) return [bx + sy, by + sx];
    if (rotate === 180) return [bx + bw - sx, by + sy];
    if (rotate === 270) return [bx + bw - sy, by + bh - sx];
    return [bx + sx, by + bh - sy];
  };
}
