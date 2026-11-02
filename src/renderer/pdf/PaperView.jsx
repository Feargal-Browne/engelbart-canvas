// PaperView — the "Paper" pane: a PDF drawn page by page with pdf.js, each page one white
// sheet, rough.js zigzag highlights and Caveat handwritten notes. Port of
// the design's syncPdf / pdfMouseUp / freeWidth / pendingSelKey / addMark / renderMarks
// (design/goal-canvas/Goal Canvas.dc.html lines 516–602), with two changes: marks are stored in
// page units (fractions of the page's drawn width) so they survive a re-layout at another zoom,
// and the document is parsed once and only re-laid-out on zoom or resize.
// Zoom follows the "Stage" design (Add - Mention Stage.dc.html, 2026-09-23), with 100% = fit width
// (Hudson, 2026-09-23: "I want fit width for 100%"): at 100% the first page is exactly as wide as the
// pane, and every zoom is that width times the percentage, so a resized pane keeps its zoom and
// redraws. Pages are centered with no gutter of their own; a floating bar at the bottom shows the
// page and zoom; a pinch (or ⌘ / ⌃ scroll) zooms around the pointer.
// `target` (2026-09-30): a passage a link asked for. Once every page's text is drawn it is found from page 1, scrolled to and
// shown as a section (showSection), and told through onTarget(text, result); once per target, until the prop is cleared
// and given again. Nothing matching leaves the scroll where it is. `targetTo` (@discover round 2): the first words of the
// section after it; the stretch from the passage to just before them, up to six pages on, is tinted (SECTION), else the
// passage alone is. The section is find's no longer (2026-10-03, the Stage's Sections menu): it stays while find
// searches and stops, until another is shown or clearSection(). `initialSection` { find, to }: the section to show the
// same way when the viewer opens with no target (a tab with a guide's sections come to the front again). Never ink.
// A margin note mentions library items (MATH-21, 2026-10-05): `@` in it opens the @ menu (`mentionItems`, the workspace's
// list, of which only library rows are kept, and Bart at the start of a highlight's note: MATH-27), and a pick writes
// `@[Name](lib:<id>)` into the note (model/doc.js libMention).
// A note no one is typing in is shown as text (`data-note-view`), its mentions links: a click on one is
// `onOpenMention(id)`, a click anywhere else in it gives the note its field back, the caret where it was clicked. Its
// names are the library's now (`library`), so a renamed item shows its new name; one gone from the library is grey. With
// no `onOpenMention` a note is its field alone, as before: the token reads as typed.
// A library folder in the note's @ menu opens in place (MATH-22, with `listFolder`), as in a document, and a file in it is
// written `@[Name](lib:<folderId>:<path>)` (model/doc.js fileMention): its chip is clicked to `onOpenFile({ folderId,
// rel, name })`, and drawn grey when `fileState(folderId, rel)` says it is gone.
// The page as a canvas (MATH-27 phase 1, 2026-10-06; the pure parts are ./canvas.js). Every page lies on a desk at least
// DESK desk px wide each side (scaled with the page since the true canvas, below), that a box moved past its edge widens.
// Every note is a box with a grip (no border, 2026-10-06): a highlight's note opens on the desk beside it (its `side`), a double-click on blank space (a click
// until 2026-10-06) makes a free note there, and dragging the grip moves either (`pos`, page units, saved on drop); a click in its text edits it. Each
// answer Bart gave from a highlight's note (`asks`) is a box under the note, joined by a short line, moved the same way.
// Boxes that were not moved are spaced on every draw (canvas.js spaceBoxes), never saved. A note on a highlight that
// starts with @bart asks on Enter (`onAsk`; Shift+Enter is a new line), and a second one continues the exchange (its
// `asks` go as the turns). An answer being written (`pendingAsks`, the workspace's) is a box of its own until it lands
// (`addAsk`, from the Stage). Space-drag or a middle-drag pans; a fade says where boxes are out of view. Since 2026-10-07
// (David) there is no chip ("2 notes →") with it, and the bar has no Fit page or Fit page + notes.
// Follow-ups (2026-10-06): the boxes hanging under a moved one widen the desk as it does (canvas.js deskNeed), while it is
// dragged too; @bart from a part of a selection across pages sends the whole passage (./marks.js passageOf), and so does
// Continue in workspace; a deleted answer comes back with ⌘Z (undoKey) and stays a turn of its exchange, so the next
// question goes on in the same session (canvas.js exchangeOf); Space, ⌘Z and a pending selection's keys are the paper's
// only while nothing has the keyboard (keyFree).
// Second pass (2026-10-06): a box being written is filled in place as Bart works (fillRun), its Stop and "▸ steps" the
// same buttons throughout, so a click on one is not lost to the next tick; an answer that is here already is not added
// again (addAsk: main tells every window how an ask ended, the one that asked too).
// A true canvas (MATH-27 follow-up, 2026-10-06): what is drawn on the desk scales with the page. Boxes and the
// lines joining them are laid out in desk px (./canvas.js: the px of 100%) on each sheet's notes layer, and
// that layer is scaled by the page's zoom (`k`, geo[n].k: the layout's zoom), so at 200% a note is 480px wide, its
// type twice as big and its gap from the page twice as wide, and a box keeps its place against the page's text at every
// zoom, moved or not. The desk is DESK desk px a side, k times as wide in a layout. A pinch scales what is drawn, and
// the drawing that follows puts every box where the pinch left it; a free note keeps the width it was measured at until
// the page's text is there to measure it again (freeW). The zoom bar, the chips, the fades and the @ menu stay screen-sized.
// One card a highlight (MATH-27 follow-up, 2026-10-06): a highlight's note and Bart's answers to it are one card, like a
// comment thread, ASK_W wide throughout: the note at the top, then each answer and each answer being written, split by a
// thin divider (cardBox). Nothing joins them now. The card moves by its one grip (the mark's `pos`); an answer moved on
// its own before is shown in its card, its `pos` no longer read. An answer's grey question shows only when it is not what
// the note asks now (canvas.js askedByNote). A question carries the page's text around the passage (pageTextAround), a
// selection snaps out to whole words (snapWords), and a card leaves its highlight's margin only as a last resort
// (marks.js NOTE_SLACK).
// Blank space and @bart (MATH-27 follow-up, 2026-10-06): a drag from blank space (the desk, or the page further than
// a line, canvas.js LINE, from its text) pans as Space-drag does, and one on or near text selects as before (pointAt); a
// click there only puts the focus and a pending selection away, and a double-click writes a free note. The cursor is a hand
// over blank space (syncCursor). A free note left empty goes when it loses the keyboard and is never saved (canvas.js
// keptMarks). A highlight's card has no arrow to it (taken out again on 2026-10-06, as MATH-15 had it).
// @bart at the start of a note that can ask is the document's blue
// label, in the note shown and, through a backdrop under its transparent text, in its field (model/doc.js noteInkHtml).
// Removing a mark (MATH-66, 2026-10-06): Backspace / Delete on the mark in focus (a highlight pressed, or a card's grip:
// the card's trash button went 2026-10-07, David), nothing having the keyboard, takes the mark away, every part of a
// selection across pages with it, and an answer still being written on it is stopped first (removeMark). No confirmation:
// a toast says so for about 5 s with Undo, and ⌘Z does the same, the mark coming back where it was with its note, answers
// and place (undoRemoval).
import React from 'react';
import * as pdfjsLib from 'pdfjs-dist';
import rough from 'roughjs';
import { mergeLineRects, placeHighlight, boxSeed, selectionParts, scalePart, partMarks, passageOf, stackNotes, wordBounds, pdfText, pageWindow } from './marks.js';
import { nextFind, createTargetGate, sectionSpans, paintSection, clearFind, FIND, FIND_ACTIVE } from '../model/find.js';
import { wheelZooms, wheelZoom, createPageCache } from '../model/paper-zoom.js';
import { nearOrder, allOrder, tooFar, DRAW_AHEAD } from '../model/paper-draw.js';
import { mentionAt, libMention, fileMention, fileMentionOf, noteHtml, noteInkHtml, noteParts, noteOffset, inlineHtml, esc, LIB_MENTION_RE } from '../model/doc.js';
import { isFolderRow, folderRows, firstPick, parentRel } from '../model/rail.js';
import { sideSpace, deskOf, deskGeom, deskNeed, placeOf, posOf, spaceBoxes, extentAt, fitZoom, offscreen, noteQuestion, askedByNote, turnsOf, shownAsks, keptMarks, runningLabel, blankAt, textColumn, DESK, DESK_EDGE, BOX_GAP, ASK_W, NOTE_W, SIDE_GAP, POS_DY, LINE, PRESS_MOVE } from './canvas.js';
import { fieldCaret } from '../workspace/caret.js';
import MentionMenu from '../workspace/MentionMenu.jsx';

// pdf.js 6: a document is torn down through its loading task (PDFDocumentProxy has no destroy()).
const destroyDoc = (doc) => { try { const task = doc && doc.loadingTask; if (task && typeof task.destroy === 'function') task.destroy().catch(() => {}); } catch { /* already gone */ } };

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const BASE = document.baseURI;
pdfjsLib.GlobalWorkerOptions.workerSrc = new URL('./pdf.worker.min.mjs', BASE).href;
// Optional asset folders next to index.html (copied by the build when present): standard
// fonts for PDFs that do not embed theirs, CMaps for CJK text, wasm image decoders.
const ASSETS = {
  standardFontDataUrl: new URL('./standard_fonts/', BASE).href,
  cMapUrl: new URL('./cmaps/', BASE).href,
  wasmUrl: new URL('./wasm/', BASE).href,
};

/* ---------------------------------------------------------------- zoom math (pure) */
// 100% = page 1 as wide as the pane. Zoom is kept as a fraction (1 = 100%).
export const ZOOM_MIN = 0.15, ZOOM_MAX = 2;
export const ZOOM_STEPS = [15, 30, 41, 67, 69, 90, 100, 110, 150, 200];
/** The fixed zoom (percent) that − (dir < 0) or + (dir > 0) goes to from `pct`, or null past the ends. */
export function zoomStep(pct, dir) {
  const r = Math.round(pct);
  if (dir > 0) { const s = ZOOM_STEPS.find((v) => v > r); return s == null ? null : s; }
  for (let i = ZOOM_STEPS.length - 1; i >= 0; i -= 1) if (ZOOM_STEPS[i] < r) return ZOOM_STEPS[i];
  return null;
}
/** 1-based page whose sheet contains y, given the sheets' ascending tops (tops[0] is page 1). */
export function pageAt(tops, y) {
  if (!tops.length) return 0;
  let lo = 0, hi = tops.length - 1;
  while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (tops[mid] <= y) lo = mid; else hi = mid - 1; }
  return lo + 1;
}
export { sideSpace };
/** Canvas pixels per CSS px: 2×, capped so one page's canvas stays near 4 million device pixels. */
export const canvasScale = (cssW, cssH) => Math.min(2, Math.sqrt(4e6 / Math.max(1, cssW * cssH)));
const PINCH_SETTLE_MS = 180;

// pdf.js 6 positions text-layer spans through CSS custom properties (--font-height,
// --scale-x, --rotate, --total-scale-factor); these rules mirror pdf_viewer.css for the
// design's .pdf-text container so selection rectangles line up with the printed text.
// .endOfContent (MATH-14, 2026-10-05) is pdf.js's TextLayerBuilder's: an empty, unselectable box at the end of each
// layer that covers it while a selection is made there (.selecting, see trackSelecting). Without it a drag ending past a
// line or in a margin lands on the layer itself, whose spans are all absolutely placed, and Chromium takes the end of the
// layer: the rest of the page was selected.
const LAYER_CSS = `
[data-pdf] .pdf-text{color-scheme:only light;overflow:clip;opacity:1;letter-spacing:normal;word-spacing:normal;caret-color:CanvasText;z-index:0;--min-font-size:1;--text-scale-factor:calc(var(--total-scale-factor) * var(--min-font-size));--min-font-size-inv:calc(1 / var(--min-font-size))}
[data-pdf] .pdf-text :is(span,br){color:transparent;position:absolute;white-space:pre;cursor:text;transform-origin:0% 0%;user-select:text}
[data-pdf] .pdf-text > :not(.markedContent),[data-pdf] .pdf-text .markedContent span:not(.markedContent){z-index:1;--font-height:0;font-size:calc(var(--text-scale-factor) * var(--font-height));--scale-x:1;--rotate:0deg;transform:rotate(var(--rotate)) scaleX(var(--scale-x)) scale(var(--min-font-size-inv))}
[data-pdf] .pdf-text .markedContent{display:contents}
[data-pdf] .pdf-text .endOfContent{display:block;position:absolute;inset:100% 0 0;z-index:0;cursor:default;user-select:none}
[data-pdf] .pdf-text.selecting .endOfContent{top:0}
[data-pdf] .pdf-text span[role="img"]{user-select:none;cursor:default}
[data-pdf][data-pinching] .pdf-text{display:none}
[data-pdf]{overflow-x:scroll!important}
[data-pdf]::-webkit-scrollbar{width:10px;height:10px;background:#fff}
[data-pdf]::-webkit-scrollbar-thumb{background:#d0d0d0;border-radius:5px;border:2px solid #fff}
[data-pdf]::-webkit-scrollbar-thumb:hover{background:#b5b5b5}
[data-pdf]::-webkit-scrollbar-corner{background:#fff}
[data-pdf][data-space],[data-pdf][data-space] *{cursor:grab!important}
[data-pdf][data-panning],[data-pdf][data-panning] *{cursor:grabbing!important}
[data-pdf] [data-grip]{cursor:grab}
[data-pdf] [data-box] [data-grip] span{opacity:0;transition:opacity 120ms}
[data-pdf] [data-box]:hover:not(:focus-within) [data-grip] span,[data-pdf] [data-box][data-focused]:not(:focus-within) [data-grip] span{opacity:1}
[data-pdf] [data-box]:hover:not(:focus-within),[data-pdf] [data-box][data-focused]:not(:focus-within){border-color:#ececec !important}
[data-pdf][data-dragging],[data-pdf][data-dragging] *{cursor:grabbing!important;user-select:none!important}
[data-pdf][data-blank]:not([data-panning]),[data-pdf][data-blank]:not([data-panning]) :not([data-notes],[data-notes] *){cursor:grab!important}
[data-pdf][data-neartext] .pdf-text,[data-pdf][data-neartext] .pdf-text .endOfContent{cursor:text!important}
[data-pdf] [data-box] button{border:0;background:transparent;padding:2px 6px;border-radius:5px;font:13px/1.4 var(--font-sans);color:#4d4d4d;cursor:pointer;white-space:nowrap}
[data-pdf] [data-box] button:hover{background:#f2f2f2}
[data-pdf] [data-box] [data-ask-body],[data-pdf] [data-box] [data-run-body]{user-select:text;cursor:text}
[data-pdf] [data-box] [data-ask-body] p,[data-pdf] [data-box] [data-run-body] p{margin:0 0 6px}
[data-pdf] [data-box] a{color:#0070f3;text-decoration:underline;text-underline-offset:2px}
@keyframes pdf-spin{to{transform:rotate(360deg)}}
::highlight(pdf-section){background-color:rgba(255,196,0,.13)}
::highlight(pdf-find){background-color:rgba(255,196,0,.35)}
::highlight(pdf-find-active){background-color:rgba(255,140,0,.6)}
`;

// The page-and-zoom bar (Stage design).
const BAR = { position: 'absolute', left: '50%', bottom: 16, transform: 'translateX(-50%)', display: 'flex', alignItems: 'center', gap: 2, height: 34, boxSizing: 'border-box', padding: '0 4px 0 12px', background: '#fff', border: '1px solid #eaeaea', borderRadius: 8, font: '400 12.5px/1 var(--font-sans)', fontVariantNumeric: 'tabular-nums', color: '#4d4d4d', whiteSpace: 'nowrap', zIndex: 5 };
const BAR_STEP = { flex: 'none', width: 26, height: 26, padding: 0, borderRadius: 6, border: 0, background: 'transparent', font: '400 14px/1 var(--font-sans)', color: '#4d4d4d', cursor: 'pointer' };
const BAR_PCT = { flex: 'none', minWidth: 48, height: 26, padding: '0 6px', borderRadius: 6, border: 0, background: 'transparent', font: '500 12.5px/1 var(--font-sans)', fontVariantNumeric: 'tabular-nums', color: '#171717', cursor: 'pointer' };
// Boxes out of view (MATH-27): a fade on each edge with some beyond it, and a chip that brings them in. The scrollbars
// are 10px (LAYER_CSS): the fades stop short of them.
const BAR_SIDE = 10;
const FADE = 36;
const fadeStyle = (side) => {
  const to = { left: 'to right', right: 'to left', up: 'to bottom', down: 'to top' }[side];
  const at = side === 'left' ? { left: 0, top: 0, bottom: BAR_SIDE, width: FADE } : side === 'right' ? { right: BAR_SIDE, top: 0, bottom: BAR_SIDE, width: FADE } : side === 'up' ? { top: 0, left: 0, right: BAR_SIDE, height: FADE } : { bottom: BAR_SIDE, left: 0, right: BAR_SIDE, height: FADE };
  return { position: 'absolute', ...at, pointerEvents: 'none', zIndex: 4, background: `linear-gradient(${to}, rgba(255,255,255,.96), rgba(255,255,255,0))` };
};
const SIDES = ['left', 'right', 'up', 'down'];
const NO_OFF = { left: 0, right: 0, up: 0, down: 0 };
// A box (MATH-27): a grip at its top that moves it. Since 2026-10-06 it is no box to see: no shadow or fill, the note ink on
// the desk; its edge is transparent (so it keeps its size) and, with its grip, shows faintly on hover or in focus, never
// while it is being typed in (David, 2026-10-06). The note in focus is not washed or edged in blue either: the
// others fade.
const BOX_BG = 'transparent';
const BOX_LOOK = `position:absolute;box-sizing:border-box;border:1px solid transparent;border-radius:8px;background:${BOX_BG};pointer-events:auto`;
const GRIP_CSS = 'height:12px;display:flex;align-items:center;justify-content:center';
const GRIP_BAR = '<span style="width:22px;height:3px;border-radius:2px;background:#d9d9d9"></span>';
const REVEAL_PAD = 16; // px a card is kept from the pane's edges: its widest (paneFit), and scrolled into view (revealCard)
const REMOVED_MS = 5000; // how long "Highlight removed · Undo" stays
const TOAST = { position: 'absolute', left: '50%', bottom: 60, transform: 'translateX(-50%)', zIndex: 6, display: 'flex', alignItems: 'center', gap: 4, height: 30, boxSizing: 'border-box', padding: '0 4px 0 12px', background: '#171717', borderRadius: 8, font: '400 12.5px/1 var(--font-sans)', color: '#fff', whiteSpace: 'nowrap', boxShadow: '0 2px 8px rgba(0,0,0,.12)' };
const TOAST_UNDO = { flex: 'none', height: 22, padding: '0 8px', border: 0, borderRadius: 5, background: 'transparent', font: '500 12.5px/1 var(--font-sans)', color: '#fff', cursor: 'pointer' };
const DIVIDER = 'border-top:1px solid #ececec'; // between the note and an answer in a card, and between two answers
const SPINNER = 'flex:none;width:10px;height:10px;box-sizing:border-box;border:1.5px solid #c9d9f2;border-top-color:#0070f3;border-radius:50%;animation:pdf-spin .8s linear infinite';

// Find (the Browser pane's ⌘F, 2026-09-22): matches are Ranges over the text layer, painted with
// the CSS Custom Highlight API, so the page's DOM is never touched. Space in the query matches any
// run of space, or none (pdf.js splits lines and words into separate spans), and a word may be
// broken by a hyphen at the end of a line ("construc-" / "tion"; a line break is \n here).
const escapeChar = (c) => c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const findPattern = (query) => new RegExp(query.trim().split(/\s+/).map((word) => [...word].map(escapeChar).join('(?:-\\n)?')).join('\\s*'), 'gi');
// A link's target as the gate holds it: the passage, and the start of the section after it when there is one.
const targetKey = (find, to) => (find ? (to ? `${find}\n${to}` : find) : '');
const highlights = () => (typeof CSS !== 'undefined' && CSS.highlights && typeof Highlight === 'function' ? CSS.highlights : null);

const clone = (v) => JSON.parse(JSON.stringify(v));
const markId = (prefix = 'm') => prefix + Date.now() + Math.random().toString(36).slice(2, 6); // 'g…': a selection across pages' group
// What has the keyboard when it is no field, button or link: Space, ⌘Z and a pending selection's keys can be the paper's.
const CONTROL = 'input,textarea,select,button,a[href],[contenteditable="true"]';
// A range's text as a selection gives it: its text nodes in order, a line break (<br>) as \n. Range.toString() leaves
// out line breaks, which would run one line's last word into the next one's first.
function rangeText(range) {
  const root = range.commonAncestorContainer;
  if (root.nodeType === Node.TEXT_NODE) return root.data.slice(range.startOffset, range.endOffset);
  let out = '';
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (!range.intersectsNode(node)) continue;
    if (node.nodeType === Node.TEXT_NODE) out += node.data.slice(node === range.startContainer ? range.startOffset : 0, node === range.endContainer ? range.endOffset : node.data.length);
    else if (node.nodeName === 'BR') out += '\n';
  }
  return out;
}
// A range's client rects, its text's alone (2026-10-08): each text node it takes in measured on its own, one of only
// white space skipped. The rects of the elements it takes in whole, and a lone space's sliver past the end of a line,
// were drawn as thin vertical lines. With no text in it, the range's own rects.
function textRects(range) {
  const root = range.commonAncestorContainer, out = [];
  const nodes = root.nodeType === Node.TEXT_NODE ? [root] : [];
  if (!nodes.length) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) if (range.intersectsNode(node)) nodes.push(node);
  }
  for (const node of nodes) {
    const from = node === range.startContainer ? range.startOffset : 0, to = node === range.endContainer ? range.endOffset : node.data.length;
    if (to <= from || !node.data.slice(from, to).trim()) continue;
    const part = document.createRange();
    part.setStart(node, from); part.setEnd(node, to);
    out.push(...part.getClientRects());
  }
  return out.length ? out : [...range.getClientRects()];
}
const SVG = 'http://www.w3.org/2000/svg';
// A note's handwriting, the same in its field and shown as text. Still Caveat (MATH-15, 2026-10-06), set larger: its
// x-height is small (0.36 em), so at 17px it read smaller than the paper's own text; 20px brings it near the body's,
// a little tracking keeps its letters apart, and the ink is a touch softer than black. Line height 1.2 (notes are short).
// Larger again on 2026-10-08 (Hudson: "the font of annotations should be larger"): 24px, and an answer's 15px (ANSWER_FONT).
const NOTE_INK = '#1f2633';
const ANSWER_FONT = 'font:15px/1.55 var(--font-sans)'; // an answer, and one being written, in its card (13px until 2026-10-08)
const NOTE_LOOK = `pointer-events:auto;padding:0 6px;font:500 24px/1.2 'Caveat',cursive;letter-spacing:.2px;color:${NOTE_INK};-webkit-font-smoothing:antialiased;transition:opacity 120ms,background 120ms`;

// An answer as its box draws it (MATH-27): a paragraph a line, with what Bart was told a box may hold (bold, italic,
// code, links), and a list's or a heading's mark taken off should one come anyway. answerParas: each paragraph's inside.
function answerParas(text, opts) {
  return String(text || '').split('\n').map((line) => line.trim()).filter(Boolean).map((line) => {
    const item = line.match(/^[-*] (.*)$/), head = line.match(/^#{1,6} (.*)$/);
    return item ? `• ${inlineHtml(item[1], opts)}` : head ? `<strong>${inlineHtml(head[1], opts)}</strong>` : inlineHtml(line, opts);
  });
}
const answerHtml = (text, opts) => answerParas(text, opts).map((inside) => `<p>${inside}</p>`).join('');

// A box being written is changed in place as Bart works (second pass, 2026-10-06): its Stop and "▸ steps" buttons stay
// the elements they were, so a click on one never lands between two drawings of the box and is lost. `shownHtml`: what
// each line of its steps and its answer so far was last given (syncKids); a line that reads the same is left alone, and
// a selection in it, or a link being clicked, outlasts the next tick.
const shownHtml = new WeakMap();
function syncKids(parent, htmls, make) {
  htmls.forEach((html, i) => {
    let el = parent.children[i];
    if (!el) { el = make(); parent.appendChild(el); }
    if (shownHtml.get(el) !== html) { el.innerHTML = html; shownHtml.set(el, html); }
  });
  while (parent.children.length > htmls.length) parent.lastElementChild.remove();
}
const setText = (el, text) => { if (el.textContent !== text) el.textContent = text; };
const showEl = (el, on) => { const display = on ? '' : 'none'; if (el.style.display !== display) el.style.display = display; };
/** An element made with its look, and `data` (dataset), as runBox builds a box being written. */
function makeEl(tag, css, data = {}, text = '') {
  const el = document.createElement(tag);
  if (css) el.style.cssText = css;
  Object.assign(el.dataset, data);
  if (tag === 'button') el.type = 'button';
  if (text) el.textContent = text;
  return el;
}

function toBytes(src) {
  // pdf.js transfers the buffer to its worker (detaching it), so hand it a private copy.
  if (!src) return null;
  if (src instanceof ArrayBuffer) return src.slice(0);
  if (ArrayBuffer.isView(src)) return new Uint8Array(src.buffer.slice(src.byteOffset, src.byteOffset + src.byteLength));
  return null;
}

export default class PaperView extends React.Component {
  constructor(props) {
    super(props);
    this.state = { note: 'Opening the paper…', page: 0, pages: 0, pct: 100, mention: null, mentionIdx: 0, off: NO_OFF, removed: null, browse: null };
    this.host = React.createRef();
    this.root = React.createRef(); // the pane: the paper, its bar and its chips
    this.marks = clone(props.marks || {}); // { [page]: Mark[] }, geometry in page units
    this.doc = null;
    this.gen = 0; // document generation
    this.layoutGen = 0; // page-layout generation
    this.renderTask = null;
    this.textLayer = null;
    this.drawGen = 0; // the layout whose sheets are in the DOM, once they are (drawSoon draws for it alone)
    this.pumping = 0; // the layout whose pages drawPages is drawing now
    this.textsAt = 0; // the layout whose pages all have their text
    this.drawingPage = 0; // the page renderTask is drawing
    this.pdfG = 150; // page 1's side space (per-page values live in this.geo)
    this.pdfW = null; // pane width of the current layout
    this.pageW = null; // page 1's drawn width
    this.resetGeometry();
    this.pendingSel = null;
    this.pdfDown = null;
    this.dirty = false;
    this.saveTimer = null;
    this.resizeTimer = null;
    this.pinchTimer = null;
    this.pinchAt = null;
    this.scrollRaf = 0;
    this.editing = null; // the id of the note being typed in: drawn as its field, the rest as text (see renderMarks)
    this.redrawing = 0; // > 0 while notes are taken out to be drawn again: a field losing the keyboard then is not left
    this.libDrawn = ''; // the mentioned items' names the notes were drawn with (libKey)
    this.drawn = {}; // { [page]: { boxes, units } }: the cards as last drawn (desk px), for spacing and fitting
    this.freeW = new Map(); // a free note's width (desk px) as last measured against its page's text (cardBox)
    this.cols = new Map(); // page → its text's column, { l, r } page units, once measured (columnOf)
    this.drag = null; // a box being moved by its grip
    this.pan = null; // a Space-drag or middle-drag under way
    this.space = false; // Space held over the paper: a drag pans
    this.hovered = false;
    this.openLogs = new Set(); // answers being written whose steps are shown
    this.offRaf = 0;
    this.undos = []; // what ⌘Z brings back, the last first: answers deleted, { page, markId, askId }, and marks removed, { kind: 'mark', page, mark, index, batch } a part (undoKey)
    this.removedTimer = null; // the "Highlight removed · Undo" toast going (state.removed)
    this.downHere = false; // the last press was in this pane: ⌘Z is the paper's
    this.onDown = (e) => {
      if (!(e.target.closest && e.target.closest('[data-pdf] [data-page]'))) return;
      if (e.target.closest('[data-box]')) return;
      this.pdfDown = { x: e.clientX, y: e.clientY };
      if (!e.target.closest('textarea')) this.keepPending();
      const tl = e.target.closest('[data-text-layer]');
      if (tl) tl.classList.add('selecting');
    };
    this.onUp = (e) => this.pdfMouseUp(e);
    // A selection being made (see LAYER_CSS .endOfContent): the layers it touches stay .selecting until the pointer is
    // up, the window loses focus, or a key is let go with the pointer up (pdf.js TextLayerBuilder's listeners).
    this.pointerIsDown = false;
    this.onPointerDown = (e) => {
      this.pointerIsDown = true;
      const root = this.root.current;
      this.downHere = !!(root && e && e.target && root.contains(e.target));
    };
    this.onPointerUp = () => { this.pointerIsDown = false; this.endSelecting(); };
    this.onBlur = () => { this.pointerIsDown = false; this.endSelecting(); this.holdSpace(false); };
    this.onKeyUp = (e) => { if (e && e.code === 'Space') this.holdSpace(false); if (!this.pointerIsDown) this.endSelecting(); };
    this.onSelectionChange = () => this.trackSelecting();
    this.onKeyCapture = (e) => { if (this.spaceKey(e) || this.copyKey(e) || this.pendingSelKey(e) || this.undoKey(e) || this.markKey(e)) e.stopPropagation(); };
    this.onWheel = (e) => this.pinch(e);
    this.onScroll = () => {
      if (this.state.mention) this.closeMention();
      if (this.scrollRaf) return;
      this.scrollRaf = requestAnimationFrame(() => { this.scrollRaf = 0; this.syncBar(); this.syncOffscreen(); this.drawSoon(); });
    };
    // Panning (MATH-27): Space held over the paper, or the middle button, and a drag moves the view both ways. Caught
    // before anything inside: no selection starts, no note is made, no box is grabbed.
    // A press on blank space (2026-10-06, pointAt) pans the same way once it moves PRESS_MOVE px; one that does not is a
    // click there, which puts the mark in focus and a pending selection away (blankClick), and nothing more. Like any press
    // there it takes the keyboard from a note (an empty one goes: leaveNote). A double-click there writes a free note.
    this.onEnter = () => { this.hovered = true; };
    this.onLeave = () => { this.hovered = false; this.hoverAt = null; this.syncCursor(); };
    this.onPanDown = (e) => {
      const blank = e.button === 0 && !this.space && !e.ctrlKey && this.pointAt(e.target, e.clientX, e.clientY).kind === 'blank';
      if (!(e.button === 1 || (e.button === 0 && this.space) || blank)) return;
      const host = this.host.current;
      if (!host) return;
      e.preventDefault(); e.stopPropagation();
      if (blank) this.leaveFields();
      this.pan = { x: e.clientX, y: e.clientY, left: host.scrollLeft, top: host.scrollTop, click: blank, moved: !blank };
      if (!blank) host.dataset.panning = '1';
      window.addEventListener('mousemove', this.onPanMove);
      window.addEventListener('mouseup', this.onPanUp);
    };
    this.onPanMove = (e) => {
      const host = this.host.current, p = this.pan;
      if (!host || !p) return;
      if (!p.moved) {
        if (Math.hypot(e.clientX - p.x, e.clientY - p.y) < PRESS_MOVE) return;
        p.moved = true;
        host.dataset.panning = '1';
      }
      host.scrollLeft = p.left - (e.clientX - p.x);
      host.scrollTop = p.top - (e.clientY - p.y);
    };
    this.onPanUp = () => {
      window.removeEventListener('mousemove', this.onPanMove);
      window.removeEventListener('mouseup', this.onPanUp);
      const p = this.pan;
      this.pan = null;
      const host = this.host.current;
      if (host) delete host.dataset.panning;
      if (p && p.click && !p.moved) this.blankClick();
      if (p && p.moved) this.syncOffscreenSoon();
    };
    this.onDbl = (e) => this.blankNote(e);
    // The cursor (2026-10-06): a hand over blank space, the text cursor over and near text (syncCursor), a frame at most late.
    this.hoverAt = null;
    this.hoverRaf = 0;
    this.onHover = (e) => {
      this.hoverAt = { target: e.target, x: e.clientX, y: e.clientY };
      if (this.hoverRaf || typeof requestAnimationFrame !== 'function') return;
      this.hoverRaf = requestAnimationFrame(() => { this.hoverRaf = 0; this.syncCursor(); });
    };
    this.spanCache = new WeakMap(); // a text layer → its spans' rects in its sheet's px (spanRects)
    this.painted = null; // the mark paintFocus last showed (the one in focus, or the one pointed at)
    this.onAux = (e) => { if (e.button === 1) e.preventDefault(); }; // no paste or autoscroll on a middle click
    // A box's grip held: the box follows the pointer, the view scrolls at the pane's edges (dragTick).
    this.onDragMove = (e) => { const d = this.drag; if (!d) return; d.at = { x: e.clientX, y: e.clientY }; this.dragTo(); };
    this.onDragUp = () => this.endDrag();
    this.findQuery = '';
    this.findAt = -1;
    this.findRanges = [];
    this.findSpots = []; // where each of findRanges is: { page, from, to } in its page's text
    this.section = null; // { text, to, spot }: a link's section, its start words found at `spot` ({ page, from, to })
    this.gate = createTargetGate();
    const first = props.target ? { find: props.target, to: props.targetTo } : props.initialSection || {};
    this.gate.set(targetKey(first.find, first.to));
  }

  // Zoom and layout state, dropped whenever a new document opens (which opens at 100%).
  resetGeometry() {
    this.zoom = 1; // committed zoom (fraction of fit width)
    this.live = null; // zoom while a pinch is under way, before it is laid out
    this.renderedZoom = 1; // the zoom the sheets in the DOM were drawn at
    this.css = 1; // CSS zoom on the inner wrapper (live / rendered, during a pinch or a fit resize)
    this.pages = []; // [n] PDFPageProxy
    this.v0 = []; // [n] viewport at scale 1 (pdf points)
    this.geo = []; // [n] { G, pageW, pageH, scale } in CSS px
    this.sheets = []; // [n] { wrap, canvas, hl, tl, notes }
    this.tops = []; // [n − 1] top of sheet n inside the inner wrapper (unzoomed)
    this.inner = null;
    const pages = this.pages;
    this.texts = createPageCache((n) => pages[n].getTextContent()); // each page's text, asked for once a document
  }

  componentDidMount() {
    const host = this.host.current;
    host.addEventListener('mousedown', this.onPanDown, true);
    host.addEventListener('mousedown', this.onDown);
    host.addEventListener('mouseup', this.onUp);
    host.addEventListener('auxclick', this.onAux);
    host.addEventListener('dblclick', this.onDbl);
    host.addEventListener('mousemove', this.onHover);
    host.addEventListener('mouseenter', this.onEnter);
    host.addEventListener('mouseleave', this.onLeave);
    host.addEventListener('wheel', this.onWheel, { passive: false });
    host.addEventListener('scroll', this.onScroll, { passive: true });
    window.addEventListener('keydown', this.onKeyCapture, true);
    document.addEventListener('pointerdown', this.onPointerDown);
    document.addEventListener('pointerup', this.onPointerUp);
    document.addEventListener('keyup', this.onKeyUp);
    document.addEventListener('selectionchange', this.onSelectionChange);
    window.addEventListener('blur', this.onBlur);
    this.ro = new ResizeObserver(() => this.onResize());
    this.ro.observe(host);
    this.load();
  }

  componentDidUpdate(prev, prevState) {
    if (prevState && !prevState.mention !== !this.state.mention && this.props.onMentionOpen) this.props.onMentionOpen(!!this.state.mention);
    if (prev.target !== this.props.target || prev.targetTo !== this.props.targetTo) {
      const text = this.gate.set(targetKey(this.props.target, this.props.targetTo));
      if (text) this.applyTarget(text);
    }
    if (prev.bytes !== this.props.bytes) {
      // The same paper with its file written again (the Stage's refresh: the tablet's ink came onto it): read on from
      // where it was, at the same zoom.
      const host = this.host.current;
      this.keepView = prev.bytes && this.doc && host && host.scrollHeight ? { zoom: this.zoom, at: host.scrollTop / host.scrollHeight, left: host.scrollLeft } : null;
      this.flushSave(prev.onMarksChange);
      this.marks = clone(this.props.marks || {});
      this.dirty = false;
      this.clearPending();
      this.load();
      return;
    }
    if (prev.marks !== this.props.marks && !this.dirty) {
      // Annotations arriving after the bytes (loaded separately) adopt as long as nothing
      // was edited here in the meantime. A box moved past the desk's edge widens it again.
      this.marks = clone(this.props.marks || {});
      this.reframe();
      this.renderAllMarks();
    }
    if (prev.pendingAsks !== this.props.pendingAsks) {
      this.reframe(); // an answer being written under a moved box can widen the desk, as a written one does
      this.syncPending(prev.pendingAsks || []);
    }
    // A mentioned item renamed, or gone from the library: its mentions are drawn again with its name now.
    if ((prev.library !== this.props.library || prev.fileState !== this.props.fileState) && this.libKey() !== this.libDrawn) this.renderAllMarks();
  }

  componentWillUnmount() {
    const host = this.host.current;
    if (host) {
      host.removeEventListener('mousedown', this.onPanDown, true);
      host.removeEventListener('mousedown', this.onDown);
      host.removeEventListener('mouseup', this.onUp);
      host.removeEventListener('auxclick', this.onAux);
      host.removeEventListener('dblclick', this.onDbl);
      host.removeEventListener('mousemove', this.onHover);
      host.removeEventListener('mouseenter', this.onEnter);
      host.removeEventListener('mouseleave', this.onLeave);
      host.removeEventListener('wheel', this.onWheel);
      host.removeEventListener('scroll', this.onScroll);
    }
    this.onPanUp();
    if (this.drag) this.endDrag(true);
    if (this.offRaf) cancelAnimationFrame(this.offRaf);
    if (this.hoverRaf) cancelAnimationFrame(this.hoverRaf);
    window.removeEventListener('keydown', this.onKeyCapture, true);
    document.removeEventListener('pointerdown', this.onPointerDown);
    document.removeEventListener('pointerup', this.onPointerUp);
    document.removeEventListener('keyup', this.onKeyUp);
    document.removeEventListener('selectionchange', this.onSelectionChange);
    window.removeEventListener('blur', this.onBlur);
    clearTimeout(this.removedTimer);
    if (this.ro) this.ro.disconnect();
    clearTimeout(this.resizeTimer);
    clearTimeout(this.pinchTimer);
    if (this.scrollRaf) cancelAnimationFrame(this.scrollRaf);
    if (this.state.mention && this.props.onMentionOpen) this.props.onMentionOpen(false);
    // Where the paper was read to (MATH-16): its tab, brought back to the front, opens there again (props.view).
    if (host && this.inner && this.props.onView) this.props.onView({ zoom: this.zoom, at: host.scrollHeight ? host.scrollTop / host.scrollHeight : 0, left: host.scrollLeft });
    this.flushSave(this.props.onMarksChange);
    this.gen += 1;
    this.cancelLayout();
    this.stopFind();
    this.clearSection();
    if (this.doc) { const d = this.doc; this.doc = null; destroyDoc(d); }
  }

  // In this viewer only: the Paper pane and a pdf in the Browser pane can both be open, with the same page numbers.
  find1(selector) { const host = this.host.current; return host ? host.querySelector(selector) : null; }

  // A page's drawn geometry (falls back to page 1's before the first layout).
  geom(page) { return this.geo[page] || { G: this.pdfG || 0, R: this.pdfG || 0, pageW: this.pageW || 1, k: this.renderedZoom || 1 }; }
  // The same in desk px, where its boxes are laid out (./canvas.js deskGeom).
  desk(page) { return deskGeom(this.geom(page)); }
  // Screen px per desk px on page n: its zoom, and a pinch's CSS zoom on top.
  boxScale(page) { return (this.geom(page).k || 1) * (this.css || 1); }

  /* ---------------------------------------------------------------- persistence */
  scheduleSave() {
    this.dirty = true;
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => { this.saveTimer = null; this.emit(this.props.onMarksChange); }, 300);
  }
  flushSave(cb) {
    if (!this.saveTimer) return;
    clearTimeout(this.saveTimer);
    this.saveTimer = null;
    this.emit(cb);
  }
  emit(cb) {
    if (typeof cb !== 'function') return;
    const out = {}, now = Date.now();
    for (const [page, list] of Object.entries(this.marks)) { const kept = keptMarks(list, now); if (kept.length) out[page] = clone(kept); }
    cb(out);
  }

  /* ---------------------------------------------------------------- loading */
  async load() {
    const gen = ++this.gen;
    this.cancelLayout();
    clearTimeout(this.pinchTimer); this.pinchTimer = null;
    if (this.doc) { const d = this.doc; this.doc = null; destroyDoc(d); }
    const host = this.host.current;
    this.closeMention();
    this.redrawing += 1;
    try { if (host) host.replaceChildren(); } finally { this.redrawing -= 1; }
    this.resetGeometry();
    this.setPinching(false);
    this.pdfW = null;
    this.undos = []; // another paper
    this.hideRemoved();
    this.freeW.clear();
    this.cols.clear();
    this.gate.drawing();
    const data = toBytes(this.props.bytes);
    if (!data) { this.setState({ note: 'No paper to open.', page: 0, pages: 0 }); return; }
    this.setState({ note: 'Opening the paper…', page: 0, pages: 0, pct: 100 });
    try {
      const doc = await pdfjsLib.getDocument({ data, isEvalSupported: false, ...ASSETS }).promise;
      if (gen !== this.gen) { destroyDoc(doc); return; }
      this.doc = doc;
      this.setState({ note: '' });
      const view = this.keepView || (this.props.target || this.props.initialSection ? null : this.props.view);
      this.keepView = null;
      if (view && view.zoom > 0) this.zoom = view.zoom;
      await this.layout(null);
      const h = this.host.current;
      if (view && h && gen === this.gen) { h.scrollTop = view.at * h.scrollHeight; h.scrollLeft = view.left || 0; }
    } catch (err) {
      if (gen !== this.gen) return;
      this.setState({ note: 'Could not open the paper — ' + ((err && err.message) || err) });
    }
  }

  cancelLayout() {
    this.layoutGen += 1;
    if (this.renderTask) { try { this.renderTask.cancel(); } catch (e) { /* already done */ } this.renderTask = null; }
    if (this.textLayer) { try { this.textLayer.cancel(); } catch (e) { /* already done */ } this.textLayer = null; }
  }

  /* ---------------------------------------------------------------- zoom */
  pct() { return Math.round((this.live != null ? this.live : this.zoom) * 100); }

  // CSS px per pdf point at 100% for a pane W wide: page 1 exactly fills it.
  unit(W) {
    const v = this.v0[1];
    return v ? W / v.width : 1;
  }

  setCss(v) {
    this.css = v;
    if (this.inner) this.inner.style.zoom = Math.abs(v - 1) < 1e-4 ? '' : String(v);
  }

  // While a pinch is under way the text layers are hidden: CSS zoom would otherwise restyle and lay out every one of
  // their spans on each wheel event, which is most of a pinch's cost. They show again when layout() replaces them.
  setPinching(on) {
    const host = this.host.current;
    if (!host || on === (host.dataset.pinching === '1')) return;
    if (on) host.dataset.pinching = '1'; else delete host.dataset.pinching;
  }

  hostPoint(where) {
    const host = this.host.current, r = host.getBoundingClientRect();
    const x = r.left + host.clientLeft + host.clientWidth / 2;
    return { x, y: where === 'center' ? r.top + host.clientTop + host.clientHeight / 2 : r.top + host.clientTop };
  }

  // The document point under a client point, in page units, so it can be found again at any zoom.
  anchorAt(x, y) {
    if (!this.inner || !this.tops.length) return null;
    const css = this.css, top = this.inner.getBoundingClientRect().top;
    const n = pageAt(this.tops, (y - top) / css), g = this.geo[n], s = this.sheets[n];
    if (!g || !s) return null;
    const r = s.wrap.getBoundingClientRect(), bt = n > 1 ? 1 : 0;
    return { n, fx: ((x - r.left) / css - g.G) / g.pageW, fy: ((y - r.top) / css - bt) / g.pageW, x, y };
  }

  // Scroll so the anchored document point sits under its client point again.
  restoreAnchor(a) {
    const host = this.host.current;
    if (!a || !host) return;
    const g = this.geo[a.n], s = this.sheets[a.n];
    if (!g || !s) return;
    const r = s.wrap.getBoundingClientRect(), css = this.css, bt = a.n > 1 ? 1 : 0;
    host.scrollLeft += r.left + (g.G + a.fx * g.pageW) * css - a.x;
    host.scrollTop += r.top + (bt + a.fy * g.pageW) * css - a.y;
  }

  /** Zoom to a percent of fit width, anchored at the middle of the view. */
  zoomTo(target) {
    if (!this.host.current || !this.doc) return;
    clearTimeout(this.pinchTimer); this.pinchTimer = null; this.live = null;
    this.zoom = clamp(target / 100, ZOOM_MIN, ZOOM_MAX);
    this.layout(this.hostPoint('center'));
  }
  zoomStepBy(dir) { const next = zoomStep(this.pct(), dir); if (next != null) this.zoomTo(next); }
  // The percentage goes back to 100%: the page as wide as the pane.
  togglePct() { if (this.pct() !== 100) this.zoomTo(100); }

  // The view moved so a point of page n (px from the page's top-left; null keeps that axis) is in its middle.
  centerOn(n, x, y) {
    const host = this.host.current, s = this.sheets[n], g = this.geo[n];
    if (!host || !s || !g) return;
    const r = s.wrap.getBoundingClientRect(), h = host.getBoundingClientRect(), css = this.css || 1, bt = n > 1 ? 1 : 0;
    if (x != null) host.scrollLeft += r.left + (g.G + x) * css - (h.left + host.clientLeft + host.clientWidth / 2);
    if (y != null) host.scrollTop += r.top + (bt + y) * css - (h.top + host.clientTop + host.clientHeight / 2);
  }

  // The cards of page n as ./canvas.js extentAt reads them: a moved one by its page units, one beside the page by its desk
  // px from the page's edge, any other by where it is now in page units; sizes as drawn, in desk px.
  boxShapes(n) {
    const model = this.drawn[n];
    if (!model || !this.geo[n]) return [];
    const g = this.desk(n), P = g.pageW || 1;
    return model.boxes.filter((b) => b.el && b.el.isConnected).map((b) => {
      const w = b.width, h = b.height, pos = b.how === 'pos' && b.pos;
      if (pos) return { x: { a: pos.x, b: 0 }, y: { a: pos.y, b: -POS_DY }, w, h };
      if (b.how === 'right') return { x: { a: 1, b: b.left - g.G - P }, y: { a: b.top / P, b: 0 }, w, h };
      if (b.how === 'left') return { x: { a: 0, b: b.left - g.G }, y: { a: b.top / P, b: 0 }, w, h };
      return { x: { a: (b.left - g.G) / P, b: 0 }, y: { a: b.top / P, b: 0 }, w, h };
    });
  }

  /** "Fit page": the page in view whole in the pane; `withNotes`, "Fit page + notes": zoomed out until its boxes are too.
   *  Only that page's boxes: other pages' would zoom a long paper with notes far apart down to ZOOM_MIN. */
  fitPage(withNotes = false) {
    const host = this.host.current;
    if (!host || !this.doc || !this.inner) return;
    const n = this.currentPage() || 1, v0 = this.v0[n];
    if (!v0) return;
    const W = host.clientWidth, H = host.clientHeight, unit = this.unit(W);
    const shape = { pageW1: v0.width * unit, pageH1: v0.height * unit, boxes: withNotes ? this.boxShapes(n) : [] };
    const z = fitZoom({ ...shape, availW: Math.max(40, W - 48), availH: Math.max(40, H - 48 - 50), zMin: ZOOM_MIN, zMax: ZOOM_MAX });
    clearTimeout(this.pinchTimer); this.pinchTimer = null; this.live = null;
    this.zoom = z;
    this.layout(undefined, () => {
      const e = extentAt({ ...shape, pageW1: this.geo[n].pageW / z }, z);
      this.centerOn(n, (e.left + e.right) / 2, (e.top + e.bottom) / 2);
    });
  }

  // Trackpad pinch (and ⌃ scroll) arrive as wheel events with ctrlKey, ⌘ scroll with metaKey. The drawn sheets are
  // scaled with CSS zoom at once (scroll geometry stays real), and laid out again once the pinch settles.
  pinch(e) {
    if (!wheelZooms(e)) return;
    e.preventDefault();
    if (!this.doc || !this.inner) return;
    const from = this.live != null ? this.live : this.zoom;
    const to = wheelZoom(from, e, ZOOM_MIN, ZOOM_MAX);
    if (to !== from) {
      this.closeMention();
      const a = this.anchorAt(e.clientX, e.clientY);
      this.live = to;
      this.setPinching(true);
      this.setCss(to / this.renderedZoom);
      this.restoreAnchor(a);
      this.syncBar();
    }
    this.pinchAt = { x: e.clientX, y: e.clientY };
    clearTimeout(this.pinchTimer);
    this.pinchTimer = setTimeout(() => {
      this.pinchTimer = null;
      if (this.live == null) return;
      this.zoom = this.live; this.live = null;
      this.layout(this.pinchAt);
    }, PINCH_SETTLE_MS);
  }

  onResize() {
    const host = this.host.current;
    if (!host || !this.doc) return;
    const W = host.clientWidth;
    if (!this.inner) { clearTimeout(this.resizeTimer); this.resizeTimer = setTimeout(() => this.layout(null), 200); return; }
    if (W === this.pdfW || W < 40) return;
    if (this.live == null) {
      // The zoom is a share of the pane's width: show the new width at once by scaling what is drawn,
      // then draw it for real when the resize settles.
      const pt = this.hostPoint('top'), a = this.anchorAt(pt.x, pt.y);
      this.setCss(W / this.pdfW);
      this.restoreAnchor(a);
      clearTimeout(this.resizeTimer);
      this.resizeTimer = setTimeout(() => this.layout(), 200);
      return;
    }
    this.recenter(W);
  }

  // At a fixed zoom a resize only moves the pages sideways: new side space, same drawings.
  recenter(W) {
    this.pdfW = W;
    const need = this.deskNeedNow();
    for (let n = 1; n < this.geo.length; n += 1) {
      const g = this.geo[n], s = this.sheets[n];
      if (!g || !s) continue;
      Object.assign(g, deskOf(W, g.pageW, need, g.k));
      this.place(n);
    }
    if (this.geo[1]) this.pdfG = this.geo[1].G;
    this.renderAllMarks();
  }

  // How wide the desk must be each side (./canvas.js deskNeed), at the pages' widths now, in desk px; `extra`
  // ({ left, right } desk px) for a box being dragged past it.
  deskNeedNow(extra = null) {
    const need = deskNeed(this.marks, (n) => (this.geo[n] ? this.geo[n].pageW / (this.geo[n].k || 1) : 0), (id) => this.runsOf(id));
    return extra ? { left: Math.max(need.left, extra.left || 0), right: Math.max(need.right, extra.right || 0) } : need;
  }

  // The desk made as wide as the boxes need (MATH-27), the drawings kept: each sheet takes its new sides, the boxes
  // drawn on it move with its page, and the view moves with page 1 so nothing on screen jumps. → whether anything changed.
  reframe(extra = null) {
    const host = this.host.current;
    if (!host || !this.pdfW || this.geo.length < 2) return false;
    const need = this.deskNeedNow(extra), was = this.geo[1] ? this.geo[1].G : 0;
    let changed = false;
    for (let n = 1; n < this.geo.length; n += 1) {
      const g = this.geo[n], s = this.sheets[n];
      if (!g || !s) continue;
      const next = deskOf(this.pdfW, g.pageW, need, g.k), dG = next.G - g.G;
      if (!dG && next.R === g.R) continue;
      changed = true;
      g.G = next.G; g.R = next.R;
      this.place(n);
      const model = this.drawn[n];
      if (model && dG) { for (const b of model.boxes) { b.left += dG / (g.k || 1); b.el.style.left = `${b.left}px`; } }
    }
    if (!changed) return false;
    this.pdfG = this.geo[1].G;
    host.scrollLeft += (this.pdfG - was) * (this.css || 1);
    return true;
  }

  /* ---------------------------------------------------------------- layout */
  // Everything about a sheet that depends on its geometry (side space, page size).
  place(n) {
    const g = this.geo[n], s = this.sheets[n];
    const { G, R, pageW, pageH } = g, sheetW = G + pageW + R;
    s.wrap.style.width = `${sheetW}px`;
    s.wrap.style.height = `${pageH}px`;
    // The page, white with a faint edge, on the desk (MATH-27); its drawing goes over it once it is ready.
    if (s.bg) s.bg.style.cssText = `position:absolute;left:${G}px;top:0;width:${pageW}px;height:${pageH}px;background:#fff;box-shadow:0 0 0 1px #e6e6e6`;
    if (s.canvas) s.canvas.style.cssText = `position:absolute;left:${G}px;top:0;width:${pageW}px;height:${pageH}px;background:#fff`;
    s.hl.setAttribute('width', pageW); s.hl.setAttribute('height', pageH); s.hl.setAttribute('viewBox', `0 0 ${pageW} ${pageH}`);
    s.hl.style.cssText = `position:absolute;left:${G}px;top:0;width:${pageW}px;height:${pageH}px;pointer-events:none;overflow:visible`;
    s.tl.style.left = `${G}px`; s.tl.style.top = '0'; s.tl.style.width = `${pageW}px`; s.tl.style.height = `${pageH}px`;
    // The cards in desk px, scaled to the page's zoom: as wide as the sheet once scaled, no wider (a layer scaled past the
    // sheet would widen the scroll).
    const k = g.k || 1, dw = sheetW / k, dh = pageH / k, scaled = Math.abs(k - 1) < 1e-6 ? '' : `scale(${k})`;
    for (const layer of [s.notes]) if (layer) { layer.style.width = `${dw}px`; layer.style.height = `${dh}px`; layer.style.transform = scaled; }
  }

  /* paper — drawn page by page. Each page is one white sheet on a desk (MATH-27): the desk G on its left and R on its
     right are each at least DESK px, and at least what centers the page in the pane, so the whole sheet is writable and
     there is room beside every page for its notes. Sheets stack 1px apart so page breaks still read. All sheets
     are laid out at their final size first (so the scroll position can be kept), showing the
     previous drawing stretched, then drawn starting from the page in view. `anchor` is a client
     point to keep fixed; undefined keeps the top of the view, null starts at the top with page 1 in the middle. `then`,
     when given, places the view instead, once the sheets are laid out (Fit page). */
  async layout(anchor, then = null) {
    const host = this.host.current, doc = this.doc;
    if (!host || !doc || host.clientWidth < 40) { this.setPinching(this.live != null); return; }
    this.cancelLayout();
    this.gate.drawing();
    const gen = this.layoutGen;
    try {
      for (let n = 1; n <= doc.numPages; n += 1) {
        if (!this.pages[n]) {
          const page = await doc.getPage(n);
          if (gen !== this.layoutGen) return;
          this.pages[n] = page;
          this.v0[n] = page.getViewport({ scale: 1 });
        }
      }
    } catch (err) {
      if (gen === this.layoutGen) this.setState({ note: 'Could not draw the paper — ' + ((err && err.message) || err) });
      return;
    }
    if (gen !== this.layoutGen || !this.host.current) return;

    const W = host.clientWidth, N = doc.numPages;
    this.closeMention(); // a zoom or a resize moves the note it hangs from
    const pt = anchor === undefined ? this.hostPoint('top') : anchor, at = pt ? this.anchorAt(pt.x, pt.y) : null;
    const focused = document.activeElement && host.contains(document.activeElement) && document.activeElement.dataset.mark
      ? { id: document.activeElement.dataset.mark, a: document.activeElement.selectionStart, b: document.activeElement.selectionEnd } : null;
    const z = clamp(this.zoom, ZOOM_MIN, ZOOM_MAX), unit = this.unit(W);
    this.zoom = z;

    const geo = [], sheets = [], tops = [];
    const inner = document.createElement('div');
    inner.style.cssText = 'position:relative;width:max-content;min-width:100%;margin:0 auto;display:flex;flex-direction:column;align-items:flex-start';
    const widths = [];
    for (let n = 1; n <= N; n += 1) widths[n] = Math.max(1, Math.round(this.v0[n].width * unit * z));
    const need = deskNeed(this.marks, (n) => (widths[n] || 0) / z, (id) => this.runsOf(id));
    let top = 0;
    for (let n = 1; n <= N; n += 1) {
      const v0 = this.v0[n], pageW = widths[n], scale = pageW / v0.width;
      geo[n] = { ...deskOf(W, pageW, need, z), pageW, pageH: v0.height * scale, scale, k: z };
      tops.push(top);
      top += geo[n].pageH + (n > 1 ? 1 : 0);
      const wrap = document.createElement('div');
      wrap.dataset.page = n;
      wrap.style.cssText = `position:relative;flex:none;margin:0 auto;${n > 1 ? 'border-top:1px solid transparent;' : ''}box-sizing:content-box`;
      const bg = document.createElement('div');
      // The previous drawing of this page, stretched, until the new one is ready.
      const old = this.sheets[n] && this.sheets[n].canvas;
      const hl = document.createElementNS(SVG, 'svg');
      hl.dataset.hl = n;
      const tl = document.createElement('div');
      tl.className = 'pdf-text'; tl.dataset.textLayer = n;
      tl.style.setProperty('--scale-factor', String(scale));
      tl.style.setProperty('--user-unit', '1');
      tl.style.setProperty('--total-scale-factor', String(scale));
      tl.style.setProperty('--scale-round-x', '1px');
      tl.style.setProperty('--scale-round-y', '1px');
      // Cards above every page's drawing and text (a card pushed past its page's foot stays in sight), in desk px, scaled
      // from their top-left corner to the page's zoom (place).
      const notes = document.createElement('div');
      notes.dataset.notes = n; notes.style.cssText = 'position:absolute;left:0;top:0;pointer-events:none;z-index:2;transform-origin:0 0';
      wrap.append(bg);
      if (old) wrap.append(old);
      wrap.append(hl, tl, notes);
      sheets[n] = { wrap, bg, canvas: old || null, hl, tl, notes };
      inner.appendChild(wrap);
    }

    this.redrawing += 1; // the note being typed in keeps being so (this.editing), and has the keyboard back below
    try { host.replaceChildren(inner); } finally { this.redrawing -= 1; }
    this.setPinching(this.live != null); // the new text layers show unless a pinch is still under way
    const oldGeo = this.geo;
    this.inner = inner; this.geo = geo; this.sheets = sheets; this.tops = tops; this.drawn = {};
    this.renderedZoom = z; this.css = 1;
    for (let n = 1; n <= N; n += 1) this.place(n);
    if (this.live != null) this.setCss(this.live / z);
    this.pdfW = W; this.pdfG = geo[1].G; this.pageW = geo[1].pageW;
    if (!then) {
      if (at) this.restoreAnchor(at);
      else if (anchor === null) { host.scrollTop = 0; host.scrollLeft = 0; this.centerOn(1, geo[1].pageW / 2, null); }
    }

    // A pending selection is kept in pixels of the layout it was made in, a part a page; carry it over.
    const p = this.pendingSel;
    if (p) {
      p.parts = p.parts.map((part) => (geo[part.page]
        ? scalePart(part, part.u || (oldGeo[part.page] && oldGeo[part.page].pageW), geo[part.page].pageW) : part));
    }
    this.renderAllMarks();
    if (then) then();
    if (focused) {
      const ta = this.find1(`textarea[data-mark="${focused.id}"]`);
      if (ta) { ta.focus({ preventScroll: true }); try { ta.setSelectionRange(focused.a, focused.b); } catch { /* not a text field */ } }
    }
    this.syncBar();
    this.syncOffscreen();

    // Drawn from the page in view outward, chosen again before each page (drawPages).
    this.drawGen = gen;
    await this.drawPages(gen);
  }

  // The pages the view shows, by the sheets' tops: { first, last, current }, or null before a layout.
  viewRange() {
    const host = this.host.current;
    if (!host || !this.tops.length) return null;
    const css = this.css || 1;
    return { first: pageAt(this.tops, host.scrollTop / css), last: pageAt(this.tops, (host.scrollTop + host.clientHeight) / css), current: this.currentPage() };
  }

  /* Pages drawn as the view needs them (MATH-71, ../model/paper-draw.js): one at a time, the next chosen again before
     each, so a scroll while drawing moves what comes next. The pages in view and DRAW_AHEAD each side get a drawing
     and their text; then every other page gets its text alone (find and a link's passage search every page). A page
     more than KEEP_DRAWN from the view gives its drawing back, and is drawn again when a scroll brings it near
     (drawSoon). The first time a layout's pages all have their text, a search and a passage are found again. */
  async drawPages(gen) {
    if (this.pumping === gen) return;
    this.pumping = gen;
    try {
      for (;;) {
        if (gen !== this.layoutGen) return;
        const n = this.nextDraw();
        if (!n) break;
        await this.drawPage(n, gen);
      }
      if (gen !== this.layoutGen || this.textsAt === gen) return;
      this.textsAt = gen;
      if (this.findQuery) this.report(this.find(this.findQuery, 0, { scroll: false }));
      if (this.section) { this.section.spot = this.sectionStart(this.section.text).spot; this.paintSection(); } // the text layer was drawn again: found again
      const text = this.gate.drawn();
      if (text) this.applyTarget(text);
    } catch (err) {
      if (gen === this.layoutGen) this.setState({ note: 'Could not draw the paper — ' + ((err && err.message) || err) });
    } finally {
      if (this.pumping === gen) this.pumping = 0;
    }
  }

  // After a scroll: the pages now near the view drawn, if the loop is not already at it. A drawing under way of a page
  // that has gone far from the view is stopped (it is drawn again when it comes back).
  drawSoon() {
    if (!this.inner || this.drawGen !== this.layoutGen) return;
    const r = this.viewRange(), n = this.drawingPage, s = n && this.sheets[n];
    if (r && s && this.renderTask && tooFar(n, r.first, r.last, DRAW_AHEAD)) {
      s.stopped = true;
      try { this.renderTask.cancel(); } catch (e) { /* already done */ }
    }
    if (this.pumping !== this.layoutGen) this.drawPages(this.layoutGen);
  }

  // The next page to draw (nearest the view first), drawings far from the view given back on the way; null when done.
  nextDraw() {
    const r = this.viewRange(), N = this.tops.length;
    if (!r) return null;
    for (let n = 1; n <= N; n += 1) { const s = this.sheets[n]; if (s && s.canvas && tooFar(n, r.first, r.last)) this.dropDrawing(s); }
    for (const n of nearOrder(r.first, r.last, r.current, N)) { const s = this.sheets[n]; if (s && ((!s.drawn && !s.failed) || !s.texted)) return n; }
    for (const n of allOrder(r.first, r.last, r.current, N)) { const s = this.sheets[n]; if (s && !s.texted) return n; }
    return null;
  }

  // A sheet's drawing given back: its canvas emptied (the memory goes at once, not when it is collected) and taken
  // out; the white page shows until it is drawn again.
  dropDrawing(s) {
    const c = s.canvas;
    s.canvas = null; s.drawn = false; s.failed = false;
    c.width = 0; c.height = 0;
    c.remove();
  }

  // Page n drawn as it is laid out now: its canvas if it is near the view, then its text layer if it has none. A drawing
  // that fails leaves the one before it (stretched, or the white page) and is tried again at the next layout.
  async drawPage(n, gen) {
    const page = this.pages[n], g = this.geo[n], s = this.sheets[n], r = this.viewRange();
    if (!page || !g || !s) return;
    if (!s.drawn && !s.failed && r && !tooFar(n, r.first, r.last, DRAW_AHEAD)) {
      const vp2 = page.getViewport({ scale: g.scale * canvasScale(g.pageW, g.pageH) });
      const c = document.createElement('canvas');
      c.width = Math.max(1, Math.floor(vp2.width)); c.height = Math.max(1, Math.floor(vp2.height));
      const task = page.render({ canvasContext: c.getContext('2d'), viewport: vp2 });
      this.renderTask = task; this.drawingPage = n;
      let ok = true;
      try { await task.promise; } catch (err) { ok = false; }
      if (this.renderTask === task) { this.renderTask = null; this.drawingPage = 0; }
      if (gen !== this.layoutGen) return;
      if (!ok) {
        if (!s.stopped) s.failed = true;
        s.stopped = false;
        c.width = 0; c.height = 0;
        return;
      }
      // Over the white page (s.bg) and under the highlights: a canvas put before the white page is hidden by it.
      if (s.canvas) { const was = s.canvas; was.replaceWith(c); was.width = 0; was.height = 0; } else s.wrap.insertBefore(c, s.hl);
      s.canvas = c; s.drawn = true;
      // A canvas Chromium let go of under memory pressure comes back blank: drawn again.
      if (c.addEventListener) c.addEventListener('contextrestored', () => { if (s.canvas === c) { s.drawn = false; this.drawSoon(); } });
      this.place(n);
    }
    if (s.texted) return;
    try {
      const vp = page.getViewport({ scale: g.scale });
      const textLayer = new pdfjsLib.TextLayer({ textContentSource: await this.texts.get(n), container: s.tl, viewport: vp });
      if (gen !== this.layoutGen) return;
      this.textLayer = textLayer;
      await textLayer.render();
      if (this.textLayer === textLayer) this.textLayer = null;
      if (gen !== this.layoutGen) return;
      const end = document.createElement('div');
      end.className = 'endOfContent';
      s.tl.append(end);
    } catch (err) { /* a page without a text layer is still readable */ }
    if (gen !== this.layoutGen) return;
    s.texted = true;
    // Free notes size themselves around the printed text, which only now exists.
    if ((this.marks[n] || []).some((m) => m.pos && m.note != null && !(m.rects || []).length)) this.renderMarks(n);
  }

  // The page whose sheet holds the vertical middle of the view.
  currentPage() {
    const host = this.host.current;
    if (!host || !this.tops.length) return 0;
    return pageAt(this.tops, (host.scrollTop + host.clientHeight / 2) / this.css);
  }

  syncBar() {
    const next = { page: this.currentPage(), pages: this.tops.length, pct: this.pct() };
    const s = this.state;
    if (next.page !== s.page || next.pages !== s.pages || next.pct !== s.pct) this.setState(next);
  }

  /* ---------------------------------------------------------------- find */
  /** `step` 0: a new query starts at the first match in view or below (the same query keeps its place);
   *  1 / -1: the next / previous match, wrapping. '' stops. `fromStart`: counted from page 1 (a link's passage).
   *  Answers { matches, active } (active from 1). Where it lands: ../model/find.js nextFind. */
  find(query, step = 0, { scroll = true, fromStart = false } = {}) {
    const text = String(query || '');
    if (!text.trim()) { this.stopFind(); return { matches: 0, active: 0 }; }
    const fresh = text !== this.findQuery;
    this.findQuery = text;
    const pages = this.pageTexts();
    this.findSpots = this.matchSpots(text, pages);
    this.findRanges = [];
    const spots = [];
    for (const spot of this.findSpots) {
      const range = this.rangeIn(pages, spot.page, spot.from, spot.to);
      if (range) { this.findRanges.push(range); spots.push(spot); }
    }
    this.findSpots = spots;
    const plan = nextFind({ fresh, step, count: this.findRanges.length, at: this.findAt, fromStart, firstInView: () => this.firstInView() });
    this.findAt = plan.at;
    this.paintFind(scroll && plan.scroll);
    return { matches: this.findRanges.length, active: this.findAt + 1 };
  }

  // A link's passage, every page drawn: shown as a section from page 1 (`target`, `targetTo`). Told through onTarget alone:
  // find has not been asked anything.
  applyTarget(key) {
    const [text, to = ''] = String(key).split('\n');
    const result = this.showSection(text, to);
    if (typeof this.props.onTarget === 'function') this.props.onTarget(text, result);
  }

  // Where a section starts: its words' first match from page 1, as find counts them (one with a range) → { spot, range,
  // matches }; `spot` null when they are nowhere.
  sectionStart(text, pages = this.pageTexts()) {
    let first = null, matches = 0;
    for (const spot of this.matchSpots(text, pages)) {
      const range = this.rangeIn(pages, spot.page, spot.from, spot.to);
      if (!range) continue;
      matches += 1;
      if (!first) first = { spot, range };
    }
    return { spot: first ? first.spot : null, range: first ? first.range : null, matches };
  }

  /** A section (2026-10-03, apart from find): its start words `find` found from page 1 and scrolled to, and tinted to just
   *  before `to` (paintSection). Answers { matches, active } as find would; nothing matching clears it and leaves the scroll. */
  showSection(find, to = '') {
    const text = String(find || '');
    if (!text.trim()) { this.clearSection(); return { matches: 0, active: 0 }; }
    const { spot, range, matches } = this.sectionStart(text);
    if (!spot) { this.clearSection(); return { matches: 0, active: 0 }; }
    this.section = { text, to: String(to || ''), spot };
    this.paintSection();
    this.scrollToRange(range);
    return { matches, active: 1 };
  }

  clearSection() {
    this.section = null;
    paintSection(highlights(), [], null);
  }

  // The section from its start words to just before the first match of `to` after them, one range a page
  // (../model/find.js sectionSpans). No `to`, `to` nowhere after them, or too far on: the start words alone are tinted.
  paintSection() {
    const h = highlights();
    if (!h) return;
    const s = this.section, start = s && s.spot;
    const pages = start ? this.pageTexts() : [];
    const spans = start ? (s.to && sectionSpans(start, this.matchSpots(s.to, pages))) || [start] : [];
    paintSection(h, spans.map((span) => this.rangeIn(pages, span.page, span.from, span.to)).filter(Boolean), Highlight);
  }

  stopFind() {
    this.findQuery = '';
    this.findAt = -1;
    this.findRanges = [];
    this.findSpots = [];
    clearFind(highlights());
  }

  report(result) { if (typeof this.props.onFind === 'function') this.props.onFind(result); }

  // Each page's text layer as one string (a line break is \n) → [{ page, layer, joined, locate }]; `locate(index, end)`
  // is the text node and offset at that index (`end`: the end of a stretch, so a node starting there is not it).
  pageTexts() {
    const host = this.host.current;
    if (!host) return [];
    return [...host.querySelectorAll('[data-text-layer]')].map((layer) => this.layerText(layer));
  }
  // One text layer's text (pageTexts); `indexOf(node, offset)` is where a point in one of its text nodes is in `joined`
  // (null in none of them).
  layerText(layer) {
    const nodes = [];
    let joined = '';
    const walker = document.createTreeWalker(layer, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (node.nodeType === Node.TEXT_NODE) { nodes.push({ node, start: joined.length }); joined += node.data; }
      else if (node.nodeName === 'BR') joined += '\n';
    }
    const locate = (index, end) => {
      for (let i = nodes.length - 1; i >= 0; i -= 1) {
        const { node, start } = nodes[i];
        if (end ? start < index : start <= index) return { node, offset: Math.min(index - start, node.data.length) };
      }
      return null;
    };
    const indexOf = (node, offset) => { const at = nodes.find((x) => x.node === node); return at ? at.start + offset : null; };
    return { page: Number(layer.dataset.textLayer), layer, joined, locate, indexOf };
  }

  // Where a query matches, page by page in order → [{ page, from, to }].
  matchSpots(query, pages = this.pageTexts()) {
    const pattern = findPattern(query);
    const spots = [];
    for (const { page, joined } of pages) {
      pattern.lastIndex = 0;
      for (let m = pattern.exec(joined); m; m = pattern.exec(joined)) {
        if (!m[0]) { pattern.lastIndex += 1; continue; }
        spots.push({ page, from: m.index, to: m.index + m[0].length });
      }
    }
    return spots;
  }

  // A Range over one page's text, from `from` to `to` (null: to the end of the page); null when there is nothing there.
  rangeIn(pages, page, from, to) {
    const at = pages.find((p) => p.page === page);
    if (!at) return null;
    const a = at.locate(from, false), b = to == null ? null : at.locate(to, true);
    if (!a || (to != null && !b)) return null;
    const range = document.createRange();
    range.setStart(a.node, a.offset);
    if (b) range.setEnd(b.node, b.offset); else range.setEnd(at.layer, at.layer.childNodes.length);
    return range.collapsed ? null : range;
  }

  firstInView() {
    const host = this.host.current;
    if (!host) return 0;
    const top = host.getBoundingClientRect().top;
    const i = this.findRanges.findIndex((range) => range.getBoundingClientRect().bottom >= top);
    return i < 0 ? 0 : i;
  }

  paintFind(scroll) {
    const h = highlights();
    const active = this.findRanges[this.findAt];
    if (h) {
      h.set(FIND, new Highlight(...this.findRanges.filter((range) => range !== active)));
      const on = new Highlight(...(active ? [active] : []));
      on.priority = 1;
      h.set(FIND_ACTIVE, on);
    }
    if (scroll) this.scrollToRange(active);
  }

  // A range out of view is brought a third of the way down (and across) the pane.
  scrollToRange(range) {
    const host = this.host.current;
    if (!range || !host) return;
    const box = host.getBoundingClientRect(), r = range.getBoundingClientRect();
    if (r.top < box.top + 24 || r.bottom > box.bottom - 24) host.scrollTop += r.top - box.top - host.clientHeight / 3;
    if (r.left < box.left || r.right > box.left + host.clientWidth) host.scrollLeft += r.left - box.left - host.clientWidth / 3;
  }

  /* ---------------------------------------------------------------- selection → marks */
  // The text layers a selection touches are .selecting (LAYER_CSS .endOfContent): `layers` (default: every one in this
  // viewer) stop being so, their .endOfContent back at their end. Electron 44's Chromium is 152; pdf.js moves the box next
  // to the selection's anchor only before Chromium 148, so that part of TextLayerBuilder is left out.
  endSelecting(layers) {
    const host = this.host.current;
    for (const tl of layers || (host ? host.querySelectorAll('[data-text-layer]') : [])) {
      tl.classList.remove('selecting');
      const end = tl.querySelector(':scope > .endOfContent');
      if (end && end !== tl.lastChild) tl.append(end);
    }
  }
  trackSelecting() {
    const host = this.host.current, sel = document.getSelection();
    if (!host) return;
    const ranges = [];
    for (let i = 0; sel && i < sel.rangeCount; i += 1) ranges.push(sel.getRangeAt(i));
    for (const tl of host.querySelectorAll('[data-text-layer]')) {
      if (ranges.some((range) => range.intersectsNode(tl))) tl.classList.add('selecting');
      else if (tl.classList.contains('selecting')) this.endSelecting([tl]);
    }
  }

  // A range cut into one a page: for each text layer in this viewer it touches, the range from the layer's start where it
  // began on an earlier page, to the layer's end where it goes on to a later one. → [{ page, layer, range }] in page order.
  pageRanges(range) {
    const host = this.host.current;
    if (!host) return [];
    const out = [];
    for (const tl of host.querySelectorAll('[data-text-layer]')) {
      if (!range.intersectsNode(tl)) continue;
      const part = range.cloneRange();
      if (!tl.contains(range.startContainer)) part.setStart(tl, 0);
      if (!tl.contains(range.endContainer)) part.setEnd(tl, tl.childNodes.length);
      if (!part.collapsed) out.push({ page: Number(tl.dataset.textLayer), layer: tl, range: part });
    }
    return out;
  }

  // Client rects are divided by this.css so geometry is in the layout's own pixels mid-pinch too. A fully selected span
  // gives its own box and its text's (they differ in height), and spans can overlap, so the rects are merged into one
  // box per stretch of a line (./marks.js) before anything is drawn or stored. A selection across pages (MATH-14) is one
  // part a page (pageRanges, ./marks.js selectionParts), each measured against its own page's text layer; a page that
  // gives no rects has no part.
  pdfMouseUp(e) {
    const wrap = e.target.closest && e.target.closest('[data-pdf] [data-page]');
    if (!wrap || this.pan) return;
    if (e.target.closest('textarea, [data-note-view], [data-box]')) return;
    const sel = getSelection(), css = this.css || 1;
    if (sel && !sel.isCollapsed && sel.rangeCount) {
      // Whole words at both ends (2026-10-06): the selection is snapped out before anything is measured or kept.
      const range = this.snapWords(sel.getRangeAt(0));
      sel.removeAllRanges(); sel.addRange(range);
      const cut = this.pageRanges(range);
      if (!cut.length) { this.clearPending(); return; }
      this.endSelecting(); // the pointer is up: no .endOfContent covers a layer while it is measured
      const text = sel.toString();
      const parts = selectionParts(cut.map(({ page, layer, range: part }) => {
        const box = layer.getBoundingClientRect();
        const rects = textRects(part).filter((r) => r.width > 1 && r.height > 1)
          .map((r) => ({ x: (r.left - box.left) / css, y: (r.top - box.top) / css, w: r.width / css, h: r.height / css }));
        return { page, rects, width: box.width / css, text: cut.length > 1 ? rangeText(part) : text, u: this.geom(page).pageW };
      }));
      if (!parts.length) return;
      this.pendingSel = { parts, text };
      this.showPending(); sel.removeAllRanges();
      return;
    }
    const still = this.pdfDown && Math.hypot(e.clientX - this.pdfDown.x, e.clientY - this.pdfDown.y) < PRESS_MOVE;
    // A click on a highlight (MATH-15) shows which note is its; a click anywhere else puts that away. A click writes no
    // note any more (2026-10-06): a double-click on blank space does (blankNote).
    if (still) {
      const box = wrap.getBoundingClientRect(), hit = this.markAt(Number(wrap.dataset.page), (e.clientX - box.left) / css, (e.clientY - box.top) / css);
      if (hit) this.focusMark(hit.id);
      else if (this.focusId) this.focusMark(null);
    }
  }

  /* ---------------------------------------------------------------- blank space (2026-10-06) */
  // What is under a client point: { kind } 'card' (a card, or anything not the paper's: a scrollbar), 'mark' (a highlight:
  // a click focuses it), 'text' (on the page within LINE·k px of a text span: a drag selects), 'blank' (the desk, or the
  // page further from its text: a drag pans), with the page `n` and the point in that sheet's px (x, y) when on one.
  pointAt(target, cx, cy) {
    const host = this.host.current, none = { kind: 'card' };
    if (!host || !this.inner || !target || !target.closest || !host.contains(target)) return none;
    if (target.closest('[data-box], textarea, button, a[href], [data-note-view]')) return none;
    const hr = host.getBoundingClientRect();
    if (cx >= hr.left + host.clientLeft + host.clientWidth || cy >= hr.top + host.clientTop + host.clientHeight) return none; // a scrollbar
    const wrap = target.closest('[data-page]') || this.sheetAt(cy);
    const n = wrap ? Number(wrap.dataset.page) : 0, g = this.geo[n];
    if (!g) return none;
    const r = wrap.getBoundingClientRect(), css = this.css || 1, x = (cx - r.left) / css, y = (cy - r.top) / css;
    if (this.markAt(n, x, y)) return { kind: 'mark', n, x, y };
    const page = { left: g.G, top: 0, right: g.G + g.pageW, bottom: g.pageH };
    return { kind: blankAt(page, this.spanRects(n), x, y, LINE * (g.k || 1)) ? 'blank' : 'text', n, x, y };
  }
  // The sheet level with a client y, for a point on the paper but in no sheet (below the last page).
  sheetAt(cy) {
    if (!this.inner || !this.tops.length) return null;
    const n = pageAt(this.tops, (cy - this.inner.getBoundingClientRect().top) / (this.css || 1)), s = this.sheets[n];
    return s ? s.wrap : null;
  }
  // Page n's text spans as rects in its sheet's px, measured once a text layer (again when more of it is drawn). None while
  // a pinch hides the text: the page is blank then.
  spanRects(n) {
    const s = this.sheets[n], host = this.host.current;
    if (!s || !s.tl || (host && host.dataset && host.dataset.pinching)) return [];
    const spans = s.tl.querySelectorAll('span'), had = this.spanCache.get(s.tl);
    if (had && had.count === spans.length && had.css === this.css) return had.rects;
    const wr = s.wrap.getBoundingClientRect(), css = this.css || 1, rects = [];
    for (const span of spans) {
      const r = span.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) rects.push({ left: (r.left - wr.left) / css, top: (r.top - wr.top) / css, right: (r.right - wr.left) / css, bottom: (r.bottom - wr.top) / css });
    }
    this.spanCache.set(s.tl, { count: spans.length, css: this.css, rects });
    return rects;
  }
  // A press on blank space takes the keyboard from whatever had it, as a press on a page always did (it is kept from the
  // page so no selection starts): a note being typed in is left (leaveNote).
  leaveFields() {
    const a = typeof document !== 'undefined' ? document.activeElement : null;
    if (a && a !== document.body && typeof a.blur === 'function') a.blur();
  }
  // A click on blank space: the mark in focus put away, and the pending selection kept as a highlight (keepPending).
  blankClick() {
    this.keepPending();
    if (this.focusId) this.focusMark(null);
  }
  // A double-click on blank space, a page's or the desk beside it: a free note there, with the caret in it.
  blankNote(e) {
    if (e.button !== 0 || this.space) return;
    const at = this.pointAt(e.target, e.clientX, e.clientY), g = at.kind === 'blank' && this.geo[at.n];
    if (!g) return;
    e.preventDefault();
    this.clearPending();
    const y = clamp(at.y, 0, g.pageH);
    const m = this.addMark({ page: at.n, rects: [], side: null, y, text: '' }, '', { x: at.x, y });
    requestAnimationFrame(() => { const ta = this.find1(`textarea[data-mark="${m.id}"]`); if (ta) { ta.focus({ preventScroll: true }); this.revealCard(m.id); } });
  }
  // The cursor for where the pointer is (onHover): grab over blank space (LAYER_CSS data-blank), text on a page near its
  // text (data-neartext), the page's own elsewhere. Left alone while a drag of any kind is under way.
  syncCursor() {
    const host = this.host.current;
    if (!host || this.pan || this.drag || this.pointerIsDown) return;
    const at = this.hoverAt, kind = at && !this.space ? this.pointAt(at.target, at.x, at.y).kind : '';
    if (kind === 'blank') host.dataset.blank = '1'; else delete host.dataset.blank;
    if (kind === 'text') host.dataset.neartext = '1'; else delete host.dataset.neartext;
  }

  // A selection's range widened to whole words at both ends (./marks.js wordBounds), each end in its own page's text layer.
  // An end that is not in a text node (past a line, in a margin) stays where it is.
  snapWords(range) {
    const out = range.cloneRange();
    const textAt = (node) => {
      const layer = node && node.nodeType === Node.TEXT_NODE && node.parentElement && node.parentElement.closest('[data-text-layer]');
      return layer ? this.layerText(layer) : null;
    };
    const a = textAt(range.startContainer), ai = a && a.indexOf(range.startContainer, range.startOffset);
    if (ai != null) { const to = a.locate(wordBounds(a.joined, ai, ai).from, false); if (to) out.setStart(to.node, to.offset); }
    const b = textAt(range.endContainer), bi = b && b.indexOf(range.endContainer, range.endOffset);
    if (bi != null) { const to = b.locate(wordBounds(b.joined, bi, bi).to, true); if (to) out.setEnd(to.node, to.offset); }
    return out;
  }

  // Width available for a free-placed note at (x, y), desk px: stops before the next printed text on
  // that line, so notes wrap instead of running over the page, else 8px short of the desk's edge beside it.
  freeWidth(page, x, y, h) {
    const { G, pageW, k = 1 } = this.geom(page), tl = this.find1(`[data-text-layer="${page}"]`);
    if (!tl) return 160;
    let right = (G + pageW) / k + DESK - 8;
    for (const s of tl.querySelectorAll('span')) {
      const l = (s.offsetLeft + G) / k, t = s.offsetTop / k, b = t + s.offsetHeight / k;
      if (b < y || t > y + h) continue;
      if (l > x && l < right) right = l - 6;
    }
    return Math.max(70, right - x);
  }
  // Whether page n's text is drawn and can be measured (not hidden by a pinch).
  textDrawn(page) {
    const host = this.host.current, tl = this.find1(`[data-text-layer="${page}"]`);
    return !!(tl && tl.querySelector('span') && !(host && host.dataset && host.dataset.pinching));
  }
  // Page n's text column in page units (./canvas.js textColumn), measured once its text is drawn and kept for every zoom
  // after; null until then, when cards go against the page's edge.
  columnOf(page) {
    if (this.cols.has(page)) return this.cols.get(page);
    const tl = this.find1(`[data-text-layer="${page}"]`);
    if (!tl || !this.textDrawn(page)) return null;
    const box = tl.getBoundingClientRect();
    if (!box.width) return null;
    const lefts = [], rights = [];
    for (const s of tl.querySelectorAll('span')) {
      if ((s.textContent || '').trim().length < 3) continue;
      const r = s.getBoundingClientRect();
      if (!r.width) continue;
      lefts.push((r.left - box.left) / box.width); rights.push((r.right - box.left) / box.width);
    }
    const col = textColumn(lefts, rights);
    if (col) this.cols.set(page, col);
    return col;
  }

  // Nothing has the keyboard (2026-10-06): it is on the page itself, or on something of the paper's that is no field,
  // button or link. A note's field, a button (the Stage's, the sidebar's, an answer's Copy) or the document keeps its keys.
  keyFree(t) {
    if (!t || t === document || t === document.body || t === document.documentElement) return true;
    const host = this.host.current;
    return !!(host && host.contains(t) && !(t.closest && t.closest(CONTROL)));
  }

  // Space held with the pointer over the paper, and nothing has the keyboard (keyFree): a drag pans (MATH-27). The page
  // does not scroll a screen down, as Space would make it.
  spaceKey(e) {
    if (e.code !== 'Space' || e.metaKey || e.ctrlKey || e.altKey || !this.hovered || !this.keyFree(e.target)) return false;
    e.preventDefault();
    this.holdSpace(true);
    return true;
  }
  holdSpace(on) {
    this.space = !!on;
    const host = this.host.current;
    if (!host) return;
    if (on) host.dataset.space = '1'; else delete host.dataset.space;
  }

  // ⌘Z (or Ctrl+Z) after a press in this pane, nothing having the keyboard: the answer deleted last comes back (one gone
  // meanwhile is passed over). With nothing to bring back the key is the app's.
  undoKey(e) {
    if (!this.undos.length || !this.downHere || !(e.metaKey || e.ctrlKey) || e.shiftKey || e.altKey || String(e.key).toLowerCase() !== 'z' || !this.keyFree(e.target)) return false;
    if (!this.undo()) return false;
    e.preventDefault();
    return true;
  }
  // What ⌘Z brings back: the last thing taken that is still to be had, a removed mark with all its parts at once (undoRemoval).
  undo() {
    while (this.undos.length) {
      const last = this.undos[this.undos.length - 1];
      if (last.kind === 'mark') { if (this.undoRemoval(last.batch)) return true; continue; }
      if (this.restoreAsk(this.undos.pop())) return true;
    }
    return false;
  }
  restoreAsk({ page, markId, askId }) {
    const m = ((this.marks || {})[page] || []).find((x) => x && x.id === markId);
    const a = m && (m.asks || []).find((x) => x && x.id === askId && x.deleted);
    if (!a) return false;
    delete a.deleted;
    this.reframe();
    this.renderMarks(page);
    this.scheduleSave();
    return true;
  }

  // Backspace or Delete with a highlight in focus (MATH-15), after a press in this pane and nothing having the keyboard:
  // the mark goes (removeMark). Typing in its note keeps the key, since the note's field has the keyboard.
  markKey(e) {
    if (!this.focusId || !this.downHere || (e.key !== 'Backspace' && e.key !== 'Delete') || e.metaKey || e.ctrlKey || e.altKey || !this.keyFree(e.target)) return false;
    const found = this.findMark(this.focusId);
    if (!found) return false;
    e.preventDefault();
    this.removeMark(found.page, found.m);
    return true;
  }

  // ⌘C (or Ctrl+C) with nothing else selected and nothing having the keyboard (2026-10-08): a selection on the page is
  // taken off the page once the pointer is up (it is pending, see pdfMouseUp), so the app's Copy found nothing. Its text
  // is copied, else, after a press in this pane, the passage of the highlight in focus.
  copyKey(e) {
    if (!(e.metaKey || e.ctrlKey) || e.shiftKey || e.altKey || String(e.key).toLowerCase() !== 'c' || !this.keyFree(e.target)) return false;
    const sel = getSelection();
    if (sel && !sel.isCollapsed) return false;
    const found = !this.pendingSel && this.focusId && this.downHere ? this.findMark(this.focusId) : null;
    const text = this.pendingSel ? this.pendingSel.text : found ? passageOf(this.marks, found.m) : '';
    if (!String(text || '').trim()) return false;
    e.preventDefault();
    const copy = this.props.onCopyText || ((t) => navigator.clipboard.writeText(t));
    Promise.resolve().then(() => copy(text)).catch(() => {});
    return true;
  }

  pendingSelKey(e) {
    const p = this.pendingSel; if (!p) return false;
    if (!this.keyFree(e.target)) return false;
    if (e.key === 'Escape') { this.clearPending(); return true; }
    if (e.key === 'Enter') { e.preventDefault(); this.addMark(p, null); this.clearPending(); return true; }
    if (e.key.length === 1 && !e.metaKey && !e.ctrlKey && !e.altKey) {
      e.preventDefault();
      const m = this.addMark(p, e.key); this.clearPending();
      requestAnimationFrame(() => {
        const ta = m && this.find1(`textarea[data-mark="${m.id}"]`);
        if (ta) { ta.focus({ preventScroll: true }); ta.setSelectionRange(ta.value.length, ta.value.length); this.revealCard(m.id); }
      });
      return true;
    }
    return false;
  }

  // The pending selection (merged boxes, see pdfMouseUp), each part drawn into its page's highlight layer until a note is
  // typed or it is dismissed. Over an existing highlight it is drawn on top of it. `page`: that page's part only.
  showPending(page) {
    const p = this.pendingSel; if (!p) return;
    if (page == null) this.hidePending();
    for (const part of p.parts) {
      if (page != null && part.page !== page) continue;
      const hl = this.find1(`[data-hl="${part.page}"]`); if (!hl) continue;
      const g = document.createElementNS(SVG, 'g'); g.dataset.pending = '1';
      for (const r of part.rects) {
        const el = document.createElementNS(SVG, 'rect');
        el.setAttribute('x', r.x); el.setAttribute('y', r.y); el.setAttribute('width', r.w); el.setAttribute('height', r.h); el.setAttribute('fill', 'rgba(0,112,243,.22)');
        g.appendChild(el);
      }
      hl.appendChild(g);
    }
  }
  hidePending() { const host = this.host.current; if (host) host.querySelectorAll('[data-pending]').forEach((n) => n.remove()); }
  clearPending() { this.pendingSel = null; this.hidePending(); }
  // A click away from a pending selection keeps it as a highlight with no note (David, 2026-10-07: it used to go). Escape
  // still puts it away unkept, and Delete takes a kept one away again (markKey).
  keepPending() {
    const p = this.pendingSel;
    if (p && p.parts && p.parts.length) this.addMark(p, null);
    this.clearPending();
  }

  // p carries pixel geometry from the current layout; the stored marks are in page units. A free note (`pos`) is p.page's
  // alone. A selection (`p.parts`) is one mark a part, on its own page (./marks.js partMarks): the parts of a selection
  // across pages share a `group` id, and only the first has the note. Each is placed among its page's marks (./marks.js
  // placeHighlight): inside one already there it adds nothing, and overlapping ones without notes become one. Answers
  // the mark that holds the first part (or the free note), whose note a caller may focus.
  addMark(p, note, pos) {
    if (pos) {
      const { G, pageW } = this.geom(p.page), u = pageW || 1;
      const m = { id: markId(), rects: [], side: p.side, y: p.y / u, note, text: p.text, pos: { x: (pos.x - G) / u, y: pos.y / u } };
      this.editing = m.id; // a new note opens as its field, for the caller to focus
      this.marks[p.page] = [...(this.marks[p.page] || []), m];
      this.reframe(); // one written near the desk's edge widens it, as a moved card does
      this.renderMarks(p.page);
      // Not saved while it is empty (2026-10-06, canvas.js keptMarks): the first thing typed in it saves it, and left
      // empty it goes (leaveNote).
      return m;
    }
    let first = null;
    for (const { page, mark } of partMarks(p.parts, note, markId, (n) => this.geom(n).pageW)) {
      const placed = placeHighlight(this.marks[page] || [], mark);
      this.marks[page] = placed.list;
      if (!first) { first = placed.mark; if (note != null) this.editing = first.id; }
      this.renderMarks(page);
    }
    this.scheduleSave();
    return first;
  }

  /* ---------------------------------------------------------------- removing a mark (MATH-66) */
  /** The mark `id` and its page, or null. */
  findMark(id) {
    for (const [page, list] of Object.entries(this.marks || {})) {
      const m = (list || []).find((x) => x && x.id === id);
      if (m) return { page: Number(page), m };
    }
    return null;
  }
  // Mark m of page n taken away, with every part of its selection across pages (`group`), no question asked: an answer
  // still being written on any of them is stopped first, as its Stop button would, so none lands on a mark that is gone.
  // Each part goes onto the undos where it stood ({ kind: 'mark', page, mark, index }, the parts one `batch`), and the
  // toast says so. The mark object itself is kept there, its note, answers and place with it.
  removeMark(page, m) {
    if (!m) return false;
    const parts = [];
    if (m.group) {
      for (const [n, list] of Object.entries(this.marks || {})) for (const x of list || []) if (x && x.group === m.group) parts.push({ page: Number(n), mark: x });
    } else if (((this.marks || {})[page] || []).includes(m)) parts.push({ page, mark: m });
    if (!parts.length) return false;
    const ids = new Set(parts.map((p) => p.mark.id));
    for (const p of Array.isArray(this.props.pendingAsks) ? this.props.pendingAsks : []) {
      if (p && p.askId && ids.has(p.markId) && p.error == null && this.props.onStopAsk) this.props.onStopAsk(p.askId);
    }
    const batch = markId('r'), pages = new Set();
    for (const { page: n, mark } of parts) {
      const list = this.marks[n], index = list.indexOf(mark);
      list.splice(index, 1);
      this.undos.push({ kind: 'mark', page: n, mark, index, batch });
      this.freeW.delete(mark.id);
      pages.add(n);
    }
    if (ids.has(this.editing)) this.editing = null;
    if (this.state.mention && ids.has(this.state.mention.markId)) this.closeMention();
    this.focusId = null;
    this.reframe(); // a moved card that went may have held the desk wide
    for (const n of pages) this.renderMarks(n);
    this.paintFocus(null);
    this.scheduleSave();
    const first = parts.find((p) => p.mark.note != null) || parts[0];
    this.showRemoved(batch, (first.mark.rects || []).length ? 'Highlight removed' : 'Note removed');
    return true;
  }
  // A removal undone (⌘Z, or the toast's Undo): every part of `batch` taken off the undos and put back at its index, the
  // last taken first so the indices hold. → whether one came back (one there again already is passed over).
  undoRemoval(batch) {
    const parts = this.undos.filter((u) => u.kind === 'mark' && u.batch === batch);
    if (!parts.length) return false;
    this.undos = this.undos.filter((u) => !parts.includes(u));
    const pages = new Set();
    for (const { page, mark, index } of parts.reverse()) {
      const list = this.marks[page] || (this.marks[page] = []);
      if (list.some((x) => x && x.id === mark.id)) continue;
      list.splice(Math.max(0, Math.min(index, list.length)), 0, mark);
      pages.add(page);
    }
    if (this.state.removed && this.state.removed.batch === batch) this.hideRemoved();
    if (!pages.size) return false;
    this.reframe(); // a card moved past the desk's edge widens it again
    for (const n of pages) this.renderMarks(n);
    this.scheduleSave();
    return true;
  }
  // The toast (about REMOVED_MS): "Highlight removed · Undo", or "Note removed · Undo" for a free note.
  showRemoved(batch, label) {
    clearTimeout(this.removedTimer);
    this.setState({ removed: { batch, label } });
    this.removedTimer = setTimeout(() => { this.removedTimer = null; this.setState({ removed: null }); }, REMOVED_MS);
  }
  hideRemoved() {
    clearTimeout(this.removedTimer);
    this.removedTimer = null;
    if (this.state.removed) this.setState({ removed: null });
  }

  renderAllMarks() {
    const host = this.host.current; if (!host) return;
    this.libDrawn = this.libKey();
    for (const wrap of host.querySelectorAll('[data-page]')) this.renderMarks(Number(wrap.dataset.page));
  }

  // Highlights are drawn once a page: every mark's rects merged (./marks.js mergeLineRects), one zigzag a box, seeded by
  // where the box is so it keeps its shape between renders and zooms. Marks overlapping each other, or saved with
  // doubled rects, draw no darker. A note being typed in when its page is drawn again (a mark added beside it, a free note
  // fitted once the text is drawn, a rename) has the keyboard back after.
  // Cards (MATH-27; one a mark since 2026-10-06): a mark with a note, an answer (`asks`) or an answer being written
  // (`pendingAsks`) is one card holding them all, in that order (cardBox). A card is where it was moved to (the mark's
  // `pos`), else on the desk beside its highlight, on its `side`; the cards not moved are then spaced (arrange).
  // Highlights are drawn in the page's px; cards in desk px (the page's notes layer is scaled).
  renderMarks(page) {
    const hl = this.find1(`[data-hl="${page}"]`), notes = this.find1(`[data-notes="${page}"]`);
    if (!hl || !notes) return;
    const u = this.geom(page).pageW, { G, pageW: P } = this.desk(page);
    const active = document.activeElement;
    const had = active && active.tagName === 'TEXTAREA' && notes.contains(active) ? { id: active.dataset.mark, a: active.selectionStart, b: active.selectionEnd } : null;
    this.redrawing += 1;
    try { hl.innerHTML = ''; notes.innerHTML = ''; } finally { this.redrawing -= 1; }
    const rc = rough ? rough.svg(hl) : null;
    const list = (this.marks || {})[page] || [];
    for (const b of mergeLineRects(list.flatMap((m) => m.rects || []))) {
      const r = { x: b.x * u, y: b.y * u, w: b.w * u, h: b.h * u };
      if (rc) hl.appendChild(rc.rectangle(r.x, r.y + r.h * 0.15, r.w, r.h * 0.7, { fill: 'rgba(0,112,243,.14)', fillStyle: 'zigzag', fillWeight: 1.2, hachureGap: 2.6, hachureAngle: -4, stroke: 'none', roughness: 0.9, seed: boxSeed(page, b) }));
      else { const d = document.createElementNS(SVG, 'rect'); d.setAttribute('x', r.x); d.setAttribute('y', r.y); d.setAttribute('width', r.w); d.setAttribute('height', r.h); d.setAttribute('fill', 'rgba(0,112,243,.12)'); hl.appendChild(d); }
    }
    const boxes = [], units = [], running = this.pendingOn(page);
    for (const m of list) {
      const asks = shownAsks(m), runs = running.filter((p) => p.markId === m.id);
      if (m.note == null && !asks.length && !runs.length) continue;
      const side = m.side === 'left' ? 'left' : 'right';
      const el = this.cardBox(m, asks, runs, page);
      notes.appendChild(el);
      const ta = el.querySelector('textarea');
      if (ta) this.fitNote(ta);
      const b = { el, m, page, fixed: !!m.pos, pos: m.pos || null, how: 'pos', left: 0, top: 0, width: 0, height: 0 };
      if (m.pos) Object.assign(b, placeOf(m.pos, G, P || 1));
      else { b.how = side; units.push({ id: m.id, want: Math.max(0, m.y * P - 6), side, boxes: [b] }); }
      boxes.push(b);
    }
    this.drawn[page] = { boxes, units };
    this.arrange(page);
    // Clearing the highlight layer took the pending selection with it, and the mark in focus with it (MATH-15).
    this.showPending(page);
    if (this.focusId) this.paintFocus(this.focusId);
    if (had) {
      const ta = notes.querySelector(`textarea[data-mark="${had.id}"]`);
      if (ta) { ta.focus({ preventScroll: true }); try { ta.setSelectionRange(had.a, had.b); } catch { /* not a text field */ } }
    }
    const open = this.state.mention;
    if (open && open.page === page) {
      const ta = notes.querySelector(`textarea[data-mark="${open.markId}"]`);
      if (ta && document.activeElement === ta) this.setState({ mention: { ...open, anchor: fieldCaret(ta, undefined, this.boxScale(page)) } }); else this.closeMention();
    }
    this.syncOffscreenSoon();
  }

  /* ---------------------------------------------------------------- cards (MATH-27) */
  // The spacing pass (./canvas.js spaceBoxes), in desk px, on every draw and while a card is dragged: every card measured;
  // one beside its page goes against the page's edge (a left one's right edge to it), then as high as it wants with
  // BOX_GAP from any card it shares x with. A card that was moved stays where it was put.
  arrange(page) {
    const model = this.drawn[page];
    if (!model) return;
    const { G, pageW } = this.desk(page);
    for (const b of model.boxes) { b.width = b.el.offsetWidth; b.height = b.el.offsetHeight; } // a layout size: unscaled
    const fixed = model.boxes.filter((b) => b.fixed);
    for (const b of fixed) { b.el.style.left = `${b.left}px`; b.el.style.top = `${b.top}px`; }
    // Which margin each card beside the page goes in (MATH-15, ./marks.js stackNotes): its highlight's, unless that one
    // is full where it wants to be and the other would keep it nearer. Never saved: `side` stays as it was made.
    const beside = model.units.filter((unit) => unit.boxes.length);
    const sides = new Map([...stackNotes(beside.map((unit) => ({ id: unit.id, ideal: unit.want, h: unit.boxes.reduce((h, b, i) => h + b.height + (i ? BOX_GAP : 0), 0), side: unit.side })), { gap: BOX_GAP })].map(([id, at]) => [id, at.side]));
    // Against the text's column, not the paper's edge (2026-10-06, David): over the page's own margin when it has one.
    const col = this.columnOf(page), L = col ? col.l * pageW : 0, R = col ? col.r * pageW : pageW;
    for (const unit of beside) {
      const side = sides.get(unit.id) || unit.side;
      for (const b of unit.boxes) b.left = side === 'left' ? G + L - SIDE_GAP - b.width : G + R + SIDE_GAP;
    }
    const tops = spaceBoxes(beside.map((unit) => ({ id: unit.id, want: unit.want, boxes: unit.boxes.map((b) => ({ left: b.left, width: b.width, height: b.height })) })), fixed);
    for (const unit of beside) {
      let t = tops.get(unit.id);
      for (const b of unit.boxes) { b.top = t; b.el.style.left = `${b.left}px`; b.el.style.top = `${t}px`; t += b.height + BOX_GAP; }
    }
  }


  // A mark's card (2026-10-06): the grip, then its note (being typed in, empty, or with nowhere for a mention to go: its
  // field; else its text), then each answer (askSection) and each answer being written (runBox), every one after the first
  // under a thin divider. A highlight's card is ASK_W wide throughout. A free note keeps to the room before the printed
  // text beside it, as it always did; until its page's text is drawn (a zoom has just laid the pages out) it keeps the
  // width it was last measured at. Pointing at a card marks it and its highlight (MATH-15), while the pointer is there.
  cardBox(m, asks, runs, page) {
    const { G, pageW } = this.desk(page), u = pageW || 1;
    let width = ASK_W;
    if (m.pos && !(m.rects || []).length) {
      if (this.textDrawn(page) || !this.freeW.has(m.id)) {
        const at = placeOf(m.pos, G, u);
        width = Math.max(120, Math.min(this.freeWidth(page, at.left, at.top + POS_DY, 29), NOTE_W));
        if (this.textDrawn(page)) this.freeW.set(m.id, width);
      } else width = this.freeW.get(m.id);
    }
    width = Math.min(width, this.paneFit(page)); // never wider than the pane can show
    // At most that wide, else only as wide as what it holds (2026-10-06, David: notes ran long, and one on the left of
    // its page sat far from the text). A note being typed in keeps the full width to type into.
    const typing = m.note != null && (this.editing === m.id || !String(m.note).trim() || !this.showsNotes());
    const size = typing ? `width:${width}px` : `width:max-content;min-width:${Math.min(120, width)}px;max-width:${width}px`;
    const box = document.createElement('div');
    box.dataset.box = 'card'; box.dataset.boxMark = m.id; box.dataset.noteFor = m.id;
    box.style.cssText = `${BOX_LOOK};left:0;top:0;${size};display:flex;flex-direction:column;transition:opacity 120ms,background 120ms`;
    box.onmouseenter = () => this.paintFocus(m.id);
    box.onmouseleave = () => this.paintFocus(this.focusId);
    const grip = makeEl('div', GRIP_CSS, { grip: '1' });
    grip.title = 'Drag to move';
    grip.innerHTML = GRIP_BAR;
    box.appendChild(grip);
    box.onmousedown = (ev) => ev.stopPropagation(); // not a click on the page: no new note, the pending selection stays
    this.grip(box, page);
    let n = 0;
    if (m.note != null) { box.appendChild(this.noteSection(m, page)); n += 1; }
    for (const a of asks) box.appendChild(this.askSection(m, a, page, n++ > 0));
    for (const p of runs) box.appendChild(this.runBox(p, page, n++ > 0));
    return box;
  }

  // A card's note: its field or its text, with a little room under it. The field of a note that can ask Bart lies over a
  // backdrop of its own text (2026-10-06, model/doc.js noteInkHtml), where a leading @bart is the document's blue label:
  // the field's own text is transparent, its caret and selection are not, and the two wrap alike (same look, same width).
  noteSection(m, page) {
    const sec = makeEl('div', 'flex:none;padding-bottom:4px', { cardNote: '1' });
    if (this.editing === m.id || !String(m.note).trim() || !this.showsNotes()) {
      const ta = this.noteField(m, page), inked = this.asksFrom(m);
      ta.style.cssText = `${NOTE_LOOK};display:block;width:100%;box-sizing:border-box;margin:0;border:0;background:transparent;resize:none;overflow:hidden;outline:none${inked ? `;position:relative;color:transparent;caret-color:${NOTE_INK}` : ''}`;
      if (inked) {
        const ink = makeEl('div', `${NOTE_LOOK};position:absolute;left:0;top:0;right:0;bottom:0;box-sizing:border-box;margin:0;border:0;white-space:pre-wrap;overflow-wrap:break-word;overflow:hidden;pointer-events:none`, { noteInk: m.id });
        ink.setAttribute('aria-hidden', 'true');
        ta.onscroll = () => { ink.scrollTop = ta.scrollTop; };
        const both = makeEl('div', 'position:relative');
        both.append(ink, ta);
        sec.appendChild(both);
        this.inkNote(ta);
      } else sec.appendChild(ta);
    } else {
      const view = this.noteView(m, page);
      view.style.cssText = `${NOTE_LOOK};white-space:pre-wrap;overflow-wrap:break-word;cursor:text`;
      sec.appendChild(view);
    }
    return sec;
  }

  // An answer in its card: the question in grey when it is not what the note asks now (an earlier one of the thread,
  // canvas.js askedByNote) and the model, the answer (scrolling inside past 40% of the pane's height), then Continue in
  // workspace, Copy, Delete (⌘Z brings it back) and Collapse. Collapsed it is one line, "Bart ›". `divided`: under a divider.
  askSection(m, a, page, divided) {
    const sec = document.createElement('div');
    sec.dataset.ask = String(a.id || '');
    sec.onclick = (ev) => this.askClick(ev, m, a, page);
    const line = divided ? `${DIVIDER};` : '';
    if (a.collapsed) {
      sec.style.cssText = `${line}flex:none;padding:2px 6px`;
      sec.innerHTML = `<button type="button" data-act="expand" title="${esc(a.question || '')}" style="font-weight:500;color:#171717">Bart ›</button>`;
      return sec;
    }
    // the model that wrote it (a.meta) is kept but not shown (MATH-70 build 3)
    const lib = { libName: (id) => this.libName(id) }, asked = askedByNote(a.question, m.note) ? '' : String(a.question || '');
    sec.style.cssText = `${line}flex:none;display:flex;flex-direction:column;padding-top:${divided ? 8 : 0}px;${ANSWER_FONT};color:#171717`;
    sec.innerHTML = (asked ? `<div title="${esc(asked)}" style="flex:none;padding:0 12px 6px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#8f8f8f">${esc(asked)}</div>` : '')
      + `<div data-ask-body="1" style="flex:none;max-height:${this.boxMaxHeight(page)}px;overflow:auto;padding:0 12px 2px;overflow-wrap:anywhere">${answerHtml(a.answer, lib)}</div>`
      + '<div style="flex:none;display:flex;flex-wrap:wrap;gap:2px;padding:2px 6px 4px">'
      + (this.props.onContinueAsk ? '<button type="button" data-act="continue">Continue in workspace</button>' : '')
      + (this.props.onCopyText ? '<button type="button" data-act="copy">Copy</button>' : '')
      + '<button type="button" data-act="delete">Delete</button><button type="button" data-act="collapse">Collapse</button></div>';
    return sec;
  }
  // In desk px, so that on screen it is 40% of the pane's height at any zoom (the card is scaled by it: 2026-10-08).
  boxMaxHeight(page) { const host = this.host.current; return Math.round(Math.max(140, (host && host.clientHeight ? host.clientHeight : 600) * 0.4) / (this.geom(page).k || 1)); }
  // The widest a card on page n may be, desk px, to be seen whole in the pane (2026-10-08, Hudson: "the annotation text
  // should fit to the window of the stager"): the pane's width less REVEAL_PAD each side, at the page's zoom.
  paneFit(page) {
    const host = this.host.current;
    return host && host.clientWidth ? Math.max(140, (host.clientWidth - 2 * REVEAL_PAD) / (this.geom(page).k || 1)) : Infinity;
  }
  // Mark id's card scrolled into the pane, by as little as will do (2026-10-08): a new note, an ask sent from it, an answer
  // landing in it. One bigger than the pane shows its top-left. `seen`: only when some of it is in view already, so an
  // answer landing while the paper is read elsewhere does not take the view there.
  revealCard(id, seen = false) {
    const host = this.host.current, el = id && this.find1(`[data-box-mark="${id}"]`);
    if (!host || !el) return;
    const view = this.viewRect(), r = el.getBoundingClientRect();
    if (seen && (r.right <= view.left || r.left >= view.right || r.bottom <= view.top || r.top >= view.bottom)) return;
    const along = (lo, hi, vLo, vHi) => (hi - lo > vHi - vLo - 2 * REVEAL_PAD || lo < vLo + REVEAL_PAD ? lo - vLo - REVEAL_PAD : hi > vHi - REVEAL_PAD ? hi - vHi + REVEAL_PAD : 0);
    host.scrollLeft += along(r.left, r.right, view.left, view.right);
    host.scrollTop += along(r.top, r.bottom, view.top, view.bottom);
  }

  askClick(ev, m, a, page) {
    const link = ev.target.closest && ev.target.closest('a[href]');
    if (link) { // never the app's window: the Stage opens it
      ev.preventDefault(); ev.stopPropagation();
      if (this.props.onOpenLink) this.props.onOpenLink(link.getAttribute('href'));
      return;
    }
    if (this.openFileChip(ev)) return;
    const lib = ev.target.closest && ev.target.closest('[data-lib]');
    if (lib) { ev.preventDefault(); if (this.props.onOpenMention) this.props.onOpenMention(lib.dataset.lib); return; }
    const act = ev.target.closest && ev.target.closest('[data-act]');
    if (!act) return;
    ev.preventDefault();
    const what = act.dataset.act;
    const say = (words, back) => { act.textContent = words; setTimeout(() => { if (act.isConnected) act.textContent = back; }, 1400); };
    if (what === 'copy') { if (this.props.onCopyText) this.props.onCopyText(a.answer || ''); say('Copied', 'Copy'); return; }
    if (what === 'continue') {
      if (this.props.onContinueAsk) this.props.onContinueAsk({ markId: m.id, page, quote: passageOf(this.marks, m), question: a.question || '', answer: a.answer || '', foot: (a.meta && a.meta.foot) || '' });
      say('Added', 'Continue in workspace');
      return;
    }
    // Deleted, an answer is no longer drawn but stays one of the exchange's turns (./canvas.js exchangeOf), and ⌘Z brings it back.
    if (what === 'delete') { a.deleted = true; this.undos.push({ page, markId: m.id, askId: a.id }); }
    else if (what === 'collapse') a.collapsed = true;
    else if (what === 'expand') a.collapsed = false;
    else return;
    this.reframe(); // a moved card that went may have held the desk wide
    this.renderMarks(page);
    this.scheduleSave();
  }

  // An answer being written (`pendingAsks`), in its mark's card (under a divider when `divided`). Its header says what
  // Bart is doing, with a spinner, and Stop; ▸ shows its steps; the answer comes in once it is writing. A failure says
  // why, with × to close it. Made once; each change of what Bart is doing fills it in place (fillRun).
  runBox(p, page, divided = false) {
    const box = makeEl('div', `${divided ? `${DIVIDER};` : ''}flex:none;display:flex;flex-direction:column;padding-top:${divided ? 8 : 0}px;${ANSWER_FONT};color:#171717`, { askRun: p.askId });
    box.onmousedown = (ev) => ev.stopPropagation();
    box.onclick = (ev) => this.runClick(ev, p.askId, page);
    const steps = makeEl('div', 'display:none;flex:none;padding:0 6px 4px', { runSteps: '1' });
    steps.appendChild(makeEl('button', '', { act: 'log' }));
    box.append(
      makeEl('div', 'flex:none;display:flex;align-items:center;gap:8px;padding:0 6px 4px 12px', { runHead: '1' }),
      makeEl('div', 'flex:none;padding:0 12px 6px;color:#8f8f8f;overflow:hidden;text-overflow:ellipsis;white-space:nowrap', { runQuestion: '1' }),
      makeEl('div', 'display:none;flex:none;padding:0 12px 8px;color:#c4372d;overflow-wrap:anywhere', { runError: '1' }),
      steps,
      makeEl('div', 'display:none;flex:none;padding:0 12px 6px;font-size:13px;line-height:1.7;color:#8f8f8f', { runLog: '1' }),
      makeEl('div', `display:none;flex:none;max-height:${this.boxMaxHeight(page)}px;overflow:auto;padding:0 12px 8px;color:#8f8f8f;overflow-wrap:anywhere`, { runBody: '1' }),
    );
    this.fillRun(box, p);
    return box;
  }
  fillRun(box, p) {
    const part = (name) => box.querySelector(`[data-run-${name}]`);
    const failed = p.error != null, log = Array.isArray(p.log) ? p.log : [], open = this.openLogs.has(p.askId);
    const lines = !failed && p.activity === 'Writing' && Array.isArray(p.lines) ? p.lines : [];
    // The header is made again only when the run fails (Stop goes, × comes); while it runs only its label changes.
    const head = part('head'), mode = failed ? 'failed' : 'running';
    if (head.dataset.mode !== mode) {
      head.dataset.mode = mode;
      if (failed) {
        const close = makeEl('button', '', { act: 'dismiss' }, '×');
        close.setAttribute('aria-label', 'Close');
        head.replaceChildren(makeEl('span', 'flex:1;min-width:0;font-weight:500;color:#171717', {}, 'Bart · No answer'), close);
      } else {
        head.replaceChildren(makeEl('span', SPINNER), makeEl('span', 'flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#4d4d4d', { runLabel: '1' }), makeEl('button', '', { act: 'stop' }, 'Stop'));
      }
    }
    const label = head.querySelector('[data-run-label]');
    if (label) setText(label, runningLabel(p));
    // Its question in grey only when it is not what the note asks now (canvas.js askedByNote).
    const question = part('question'), m = ((this.marks || {})[p.page] || []).find((x) => x && x.id === p.markId);
    const asked = askedByNote(p.question, m ? m.note : p.question) ? '' : String(p.question || '');
    showEl(question, !!asked);
    setText(question, asked);
    if (question.title !== asked) question.title = asked;
    const error = part('error');
    showEl(error, failed);
    if (failed) setText(error, p.error || 'The run failed.');
    const steps = part('steps'), toggle = steps.firstElementChild;
    showEl(steps, log.length > 0);
    if (log.length) {
      setText(toggle, `${open ? '▾' : '▸'} ${log.length} ${log.length === 1 ? 'step' : 'steps'}`);
      if (toggle.getAttribute('aria-expanded') !== String(open)) toggle.setAttribute('aria-expanded', String(open));
    }
    const list = part('log');
    showEl(list, open && log.length > 0);
    syncKids(list, open ? log.map((entry) => esc(entry)) : [], () => makeEl('div', 'overflow:hidden;text-overflow:ellipsis;white-space:nowrap'));
    const body = part('body'), atEnd = body.style.display === 'none' || body.scrollTop + body.clientHeight >= body.scrollHeight - 4;
    showEl(body, lines.length > 0);
    syncKids(body, answerParas(lines.join('\n')), () => makeEl('p'));
    if (lines.length && atEnd) body.scrollTop = body.scrollHeight;
  }
  runClick(ev, askId, page) {
    const link = ev.target.closest && ev.target.closest('a[href]');
    if (link) { // never the app's window: the Stage opens it, as from an answer's box
      ev.preventDefault(); ev.stopPropagation();
      if (this.props.onOpenLink) this.props.onOpenLink(link.getAttribute('href'));
      return;
    }
    const act = ev.target.closest && ev.target.closest('[data-act]');
    if (!act) return;
    ev.preventDefault();
    const what = act.dataset.act;
    if (what === 'stop' && this.props.onStopAsk) this.props.onStopAsk(askId);
    else if (what === 'dismiss' && this.props.onDismissAsk) this.props.onDismissAsk(askId);
    else if (what === 'log') {
      if (this.openLogs.has(askId)) this.openLogs.delete(askId); else this.openLogs.add(askId);
      const p = (this.props.pendingAsks || []).find((x) => x && x.askId === askId), box = this.find1(`[data-ask-run="${askId}"]`);
      if (p && box) { this.fillRun(box, p); this.arrange(page); }
    }
  }

  // How many answers are being written for mark `id`: each is a box under its others (deskNeed).
  runsOf(id) { return (Array.isArray(this.props.pendingAsks) ? this.props.pendingAsks : []).filter((p) => p && p.askId && p.markId === id).length; }

  // The answers being written for this pdf on a page.
  pendingOn(page) { return (Array.isArray(this.props.pendingAsks) ? this.props.pendingAsks : []).filter((p) => p && p.page === page && p.askId); }

  // What Bart is doing changed: a box that is already there is filled again and its page spaced; one that came or went
  // draws its page again.
  syncPending(before) {
    const now = Array.isArray(this.props.pendingAsks) ? this.props.pendingAsks : [];
    const pages = new Set([...before, ...now].filter(Boolean).map((p) => p.page));
    const ids = (list, page) => list.filter((p) => p && p.page === page).map((p) => `${p.markId}/${p.askId}`).join(',');
    const had = new Set(before.filter(Boolean).map((p) => p.askId));
    for (const page of pages) {
      if (ids(before, page) !== ids(now, page)) {
        this.renderMarks(page);
        for (const p of now) if (p && p.page === page && p.askId && !had.has(p.askId)) this.revealCard(p.markId, true); // an ask just sent
        continue;
      }
      let filled = false;
      for (const p of this.pendingOn(page)) {
        const box = this.find1(`[data-ask-run="${p.askId}"]`);
        if (box) { this.fillRun(box, p); filled = true; }
      }
      if (filled) this.arrange(page);
    }
  }

  /** A finished answer, from the Stage (MATH-27): it joins its mark's answers, drawn and saved. → whether the mark is here. */
  addAsk(page, markId, entry) {
    const m = ((this.marks || {})[page] || []).find((x) => x && x.id === markId);
    if (!m || !entry) return false;
    if ((m.asks || []).some((a) => a && a.id === entry.id)) return true; // here already (main tells every window too)
    m.asks = [...(m.asks || []), entry];
    this.reframe(); // under a moved box it holds the desk wide, as its box being written did
    this.renderMarks(page);
    this.revealCard(markId, true);
    this.scheduleSave();
    return true;
  }

  // Moving a card by its grip. A press that does not move is no drag. Moved, the card leaves the spacing, follows the
  // pointer, widens the desk when it goes past its edge, and on release keeps its place in page units (the mark's `pos`).
  grip(box, page) {
    const grip = box.querySelector('[data-grip]');
    if (grip) grip.onmousedown = (ev) => this.startDrag(ev, box, page);
  }
  startDrag(ev, el, page) {
    if (ev.button !== 0) return;
    if (el.dataset.boxMark) this.focusMark(el.dataset.boxMark); // a card's grip pressed: Backspace / Delete removes it (markKey)

    ev.preventDefault(); ev.stopPropagation();
    const model = this.drawn[page], b = model && model.boxes.find((x) => x.el === el);
    if (!b || this.drag) return;
    const r = el.getBoundingClientRect(), css = this.boxScale(page);
    this.closeMention();
    this.drag = { b, page, grabX: (ev.clientX - r.left) / css, grabY: (ev.clientY - r.top) / css, x0: ev.clientX, y0: ev.clientY, at: { x: ev.clientX, y: ev.clientY }, moved: false, raf: 0 };
    window.addEventListener('mousemove', this.onDragMove);
    window.addEventListener('mouseup', this.onDragUp);
  }
  // The card out of the spacing: it stays where it is put.
  detach(model, b) {
    b.fixed = true; b.how = 'pos';
    if (model) for (const unit of model.units) unit.boxes = unit.boxes.filter((x) => x !== b);
  }
  dragTo() {
    const d = this.drag, host = this.host.current, s = d && this.sheets[d.page], g = d && this.geo[d.page];
    if (!d || !host || !s || !g) return;
    if (!d.moved) {
      if (Math.hypot(d.at.x - d.x0, d.at.y - d.y0) < 3) return;
      d.moved = true;
      host.dataset.dragging = '1';
      this.detach(this.drawn[d.page], d.b);
      this.dragTick();
    }
    const css = this.boxScale(d.page), k = g.k || 1, b = d.b; // desk px
    let wr = s.wrap.getBoundingClientRect();
    b.left = (d.at.x - wr.left) / css - d.grabX;
    b.top = Math.max(-(this.tops[d.page - 1] || 0) / k, (d.at.y - wr.top) / css - d.grabY);
    this.arrange(d.page);
    const extra = this.reach(d.page);
    if ((extra.left * k > g.G || extra.right * k > g.R) && this.reframe(extra)) {
      wr = s.wrap.getBoundingClientRect(); b.left = (d.at.x - wr.left) / css - d.grabX;
      this.arrange(d.page);
    }
  }
  // How far past page n its moved cards reach as drawn, DESK_EDGE added → { left, right } desk px.
  reach(n) {
    const model = this.drawn[n], out = { left: 0, right: 0 };
    if (!model || !this.geo[n]) return out;
    const g = this.desk(n);
    for (const x of model.boxes) {
      if (x.how !== 'pos') continue;
      out.left = Math.max(out.left, DESK_EDGE - (x.left - g.G));
      out.right = Math.max(out.right, x.left + x.width + DESK_EDGE - g.G - g.pageW);
    }
    return out;
  }
  // Held near an edge of the pane, the view scrolls that way and the box goes with it.
  dragTick() {
    const d = this.drag, host = this.host.current;
    if (!d || !host || typeof requestAnimationFrame !== 'function') return;
    const r = host.getBoundingClientRect(), edge = 28, speed = 14;
    const dx = d.at.x < r.left + edge ? -speed : d.at.x > r.left + host.clientWidth - edge ? speed : 0;
    const dy = d.at.y < r.top + edge ? -speed : d.at.y > r.top + host.clientHeight - edge ? speed : 0;
    if (dx || dy) {
      const left = host.scrollLeft, top = host.scrollTop;
      host.scrollLeft += dx; host.scrollTop += dy;
      if (host.scrollLeft !== left || host.scrollTop !== top) this.dragTo();
    }
    d.raf = requestAnimationFrame(() => this.dragTick());
  }
  endDrag(cancel = false) {
    const d = this.drag;
    window.removeEventListener('mousemove', this.onDragMove);
    window.removeEventListener('mouseup', this.onDragUp);
    this.drag = null;
    if (!d) return;
    if (d.raf && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(d.raf);
    const host = this.host.current;
    if (host) delete host.dataset.dragging;
    if (!d.moved || cancel) return;
    const g = this.desk(d.page), pos = posOf(d.b.left, d.b.top, g.G, g.pageW || 1);
    d.b.m.pos = pos;
    this.reframe();
    this.renderMarks(d.page);
    this.scheduleSave();
  }

  /* ---------------------------------------------------------------- boxes out of view (MATH-27) */
  viewRect() {
    const host = this.host.current, r = host.getBoundingClientRect();
    return { left: r.left + host.clientLeft, top: r.top + host.clientTop, right: r.left + host.clientLeft + host.clientWidth, bottom: r.top + host.clientTop + host.clientHeight };
  }
  // The boxes of the pages in view, as client rects: a page further on is not "out of view", it is further on.
  boxRects(view) {
    const out = [];
    for (let n = 1; n < this.sheets.length; n += 1) {
      const s = this.sheets[n];
      if (!s) continue;
      const r = s.wrap.getBoundingClientRect();
      if (r.bottom < view.top || r.top > view.bottom) continue;
      for (const el of s.notes.querySelectorAll('[data-box]')) out.push(el.getBoundingClientRect());
    }
    return out;
  }
  syncOffscreen() {
    const host = this.host.current;
    const off = host && this.inner && !this.pan ? offscreen(this.boxRects(this.viewRect()), this.viewRect()) : NO_OFF;
    const was = this.state.off || NO_OFF;
    if (SIDES.some((side) => was[side] !== off[side])) this.setState({ off });
  }
  syncOffscreenSoon() {
    if (this.offRaf || typeof requestAnimationFrame !== 'function') return;
    this.offRaf = requestAnimationFrame(() => { this.offRaf = 0; this.syncOffscreen(); });
  }

  /* ---------------------------------------------------------------- the mark in focus (MATH-15) */
  // The mark `id` and its note shown together (MATH-15, merged into the canvas 2026-10-06): its highlight drawn darker
  // over the page and its card on a faint wash with a blue edge, every other mark's card faded. A press on a highlight
  // keeps it (this.focusId); pointing at a card shows its own while the pointer is there. null shows none. The darker
  // highlight goes on the page's highlight layer (page px).
  paintFocus(id) {
    const host = this.host.current; if (!host) return;
    this.painted = id || null;
    for (const el of host.querySelectorAll('[data-focus]')) el.remove();
    for (const el of host.querySelectorAll('[data-box-mark]')) {
      const mine = !!id && el.dataset.boxMark === id;
      el.style.opacity = id && !mine ? '0.45' : '';
      if (this.focusId && el.dataset.boxMark === this.focusId) el.dataset.focused = '1'; else delete el.dataset.focused; // its trash button shows
    }
    if (!id) return;
    for (const [page, list] of Object.entries(this.marks || {})) {
      const m = (list || []).find((x) => x && x.id === id); if (!m || !m.rects || !m.rects.length) continue;
      const hl = this.find1(`[data-hl="${page}"]`); if (!hl) continue;
      const u = this.geom(Number(page)).pageW;
      for (const b of mergeLineRects(m.rects)) {
        const d = document.createElementNS(SVG, 'rect');
        d.dataset.focus = '1';
        d.setAttribute('x', b.x * u - 1); d.setAttribute('y', b.y * u + b.h * u * 0.1); d.setAttribute('width', b.w * u + 2); d.setAttribute('height', b.h * u * 0.8);
        d.setAttribute('rx', 2); d.setAttribute('fill', 'rgba(0,112,243,.16)'); d.setAttribute('stroke', 'rgba(0,112,243,.55)'); d.setAttribute('stroke-width', 1);
        hl.appendChild(d);
      }
    }
  }
  // The mark under a point of a page, given in the sheet's own pixels: the last drawn wins (it is on top).
  markAt(page, x, y) {
    const { G, pageW: u } = this.geom(page), list = (this.marks || {})[page] || [];
    for (let i = list.length - 1; i >= 0; i -= 1) {
      const m = list[i];
      if (m && m.rects && m.rects.some((r) => x >= G + r.x * u - 2 && x <= G + (r.x + r.w) * u + 2 && y >= r.y * u - 2 && y <= (r.y + r.h) * u + 2)) return m;
    }
    return null;
  }
  focusMark(id) { this.focusId = id || null; this.paintFocus(this.focusId); }

  /* ---------------------------------------------------------------- notes (MATH-21: mentions) */
  // Notes are shown as text, their mentions links, once there is somewhere for a link to go.
  showsNotes() { return typeof this.props.onOpenMention === 'function'; }
  fitNote(ta) { ta.style.height = 'auto'; ta.style.height = ta.scrollHeight + 'px'; }
  // A note's field's backdrop (noteSection) given the field's text as it is now; a field with none is left alone.
  inkNote(ta) {
    const ink = ta && ta.parentNode && ta.parentNode.querySelector ? ta.parentNode.querySelector('[data-note-ink]') : null;
    if (!ink) return;
    const html = noteInkHtml(ta.value);
    if (ink.innerHTML !== html) ink.innerHTML = html;
    ink.scrollTop = ta.scrollTop || 0;
  }

  // A mentioned item's name now: null when the library no longer holds it; undefined (the name it was mentioned by)
  // when there is no library to ask, or none yet.
  libName(id) {
    const lib = this.props.library;
    if (!Array.isArray(lib) || !lib.length) return undefined;
    const row = lib.find((r) => r && r.id === id);
    return row ? row.name || '' : null;
  }
  // A file in a library folder a note mentions (MATH-22): false when it is gone, undefined until that is known.
  fileState(folderId, rel) { return typeof this.props.fileState === 'function' ? this.props.fileState(folderId, rel) : undefined; }
  // A file's chip clicked (MATH-22): opened in the Stage, or told it is gone. → whether the click was one
  openFileChip(ev) {
    const chip = ev.target.closest && ev.target.closest('[data-file]');
    if (!chip || !chip.dataset.folder) return false;
    ev.preventDefault(); ev.stopPropagation();
    if (this.props.onOpenFile) this.props.onOpenFile({ folderId: chip.dataset.folder, rel: chip.dataset.file, name: chip.dataset.mention });
    return true;
  }
  // The names now of every item the notes mention, as one string: the notes are drawn again when it changes.
  libKey() {
    const ids = new Set(), files = new Set();
    for (const list of Object.values(this.marks || {})) {
      for (const m of list || []) {
        if (!m || !m.note) continue;
        for (const part of noteParts(m.note)) {
          const t = part.match(LIB_MENTION_RE), f = fileMentionOf(part);
          if (t) ids.add(t[2]);
          if (f) { ids.add(f.folderId); files.add(JSON.stringify([f.folderId, f.rel])); }
        }
      }
    }
    const state = (key) => { const [id, rel] = JSON.parse(key); const known = this.fileState(id, rel); return known === undefined ? '?' : known ? (known.dir ? 'd' : 'f') : '-'; };
    return [...[...ids].sort().map((id) => `${id}\t${this.libName(id)}`), ...[...files].sort().map((key) => `${key}\t${state(key)}`)].join('\n');
  }

  // A note being typed in: its text, saved as it changes, and the @ menu opened by what stands before the caret.
  noteField(m, page) {
    const ta = document.createElement('textarea');
    ta.dataset.mark = m.id; ta.value = m.note; ta.rows = 1; ta.spellcheck = false;
    ta.oninput = () => { m.note = ta.value; this.inkNote(ta); this.fitNote(ta); this.arrange(page); this.scheduleSave(); this.noteMention(ta, m, page); };
    ta.onfocus = () => { this.editing = m.id; if (m.rects && m.rects.length) this.focusMark(m.id); };
    ta.onblur = () => this.leaveNote(ta, m, page);
    ta.onkeydown = (ev) => this.noteKey(ev, ta, m, page);
    // The caret moved along the line: the menu follows what stands before it now (↑ and ↓ are the menu's).
    ta.onkeyup = (ev) => { if (/^(ArrowLeft|ArrowRight|Home|End)$/.test(ev.key) && this.state.mention && this.state.mention.markId === m.id) this.noteMention(ta, m, page); };
    ta.onmousedown = (ev) => ev.stopPropagation();
    return ta;
  }
  // A note no one is typing in, as text: a mention opens its item; a click anywhere else is a click into its field.
  noteView(m, page) {
    const view = document.createElement('div');
    view.dataset.noteView = m.id;
    view.innerHTML = noteHtml(m.note, { libName: (id) => this.libName(id), fileState: (id, rel) => this.fileState(id, rel), agents: this.asksFrom(m) });
    view.onmousedown = (ev) => {
      ev.stopPropagation(); // not a click on the page: no new note, the pending selection stays (as in a field)
      if (ev.button !== 0) return;
      ev.preventDefault();
      if (ev.target.closest && ev.target.closest('[data-lib],[data-file]')) return; // its click opens it
      this.editNote(m, page, this.noteCaret(view, m, ev));
    };
    view.onclick = (ev) => {
      if (this.openFileChip(ev)) return;
      const link = ev.target.closest && ev.target.closest('[data-lib]');
      if (!link) return;
      ev.preventDefault(); ev.stopPropagation();
      if (this.props.onOpenMention) this.props.onOpenMention(link.dataset.lib);
    };
    return view;
  }
  // Where in the note's text a click on its shown text lands (model/doc.js noteOffset); null when it cannot be told.
  noteCaret(view, m, ev) {
    const r = typeof document.caretRangeFromPoint === 'function' ? document.caretRangeFromPoint(ev.clientX, ev.clientY) : null;
    if (!r || !view.contains(r.startContainer)) return null;
    let node = r.startContainer;
    const opts = { agents: this.asksFrom(m) }; // the pieces noteView drew (model/doc.js noteParts)
    if (node === view) return r.startOffset ? noteOffset(m.note, r.startOffset - 1, Infinity, opts) : 0; // between two pieces
    while (node.parentNode !== view) node = node.parentNode;
    return noteOffset(m.note, [...view.childNodes].indexOf(node), node === r.startContainer && node.nodeType === Node.TEXT_NODE ? r.startOffset : Infinity, opts);
  }
  // The note's field in place of its text, with the keyboard and the caret at `at` (the end when null). The note typed
  // in until now is left first, as a click away from it leaves it: an empty one goes, a written one shows as text.
  editNote(m, page, at) {
    const host = this.host.current, active = document.activeElement;
    if (host && active && active.tagName === 'TEXTAREA' && active.dataset.mark && host.contains(active)) active.blur();
    this.editing = m.id;
    this.renderMarks(page);
    const ta = this.find1(`textarea[data-mark="${m.id}"]`);
    if (!ta) return;
    ta.focus({ preventScroll: true });
    const pos = at == null ? ta.value.length : Math.max(0, Math.min(at, ta.value.length));
    ta.setSelectionRange(pos, pos);
  }
  // The keyboard left a note's field. Empty, the note goes (a highlight keeps its mark); written, it shows as text a frame
  // later, so a click that moved the keyboard to another field on the page is not undone by drawing the page again. A
  // field taken out to be drawn again was not left; the app going to the background leaves it as it is.
  leaveNote(ta, m, page) {
    if (this.redrawing || !ta.isConnected) return;
    if (this.state.mention && this.state.mention.markId === m.id) this.closeMention();
    if (!ta.value.trim()) {
      if (this.editing === m.id) this.editing = null;
      const list = this.marks[page] || [], at = list.indexOf(m);
      if (m.rects.length) m.note = null; else if (at >= 0) list.splice(at, 1);
      this.renderMarks(page);
      this.scheduleSave();
      return;
    }
    if (document.activeElement === ta) return;
    if (this.editing === m.id) this.editing = null;
    if (this.showsNotes()) requestAnimationFrame(() => { if (this.editing !== m.id) this.renderMarks(page); });
  }

  // The @ menu in a note (as in a follow-up field, DocEditor followMention): open while an `@word` stands before the caret.
  noteMention(ta, m, page) {
    const found = typeof this.props.mentionItems === 'function' ? mentionAt(ta.value, ta.selectionStart) : null;
    if (found) this.setState({ mention: { markId: m.id, page, query: found.query, start: found.start, anchor: fieldCaret(ta, undefined, this.boxScale(page)) }, mentionIdx: 0 });
    else this.closeMention();
  }
  closeMention() { if (this.state.mention || this.state.browse) this.setState({ mention: null, browse: null }); }

  /* ------------------------------------------------- a library folder in a note's @ menu (MATH-22) */
  mentionKey(open) { return open ? `${open.markId}:${open.start}` : null; }
  /** The folder the menu is in → { at, row, rel, listing }, or null at the menu's top. */
  browsing() { const b = this.state.browse, open = this.state.mention; return b && open && b.at === this.mentionKey(open) ? b : null; }
  // The menu goes into `rel` of the folder `row`: what was typed to find it is taken out of the note, and the level is
  // asked of main (listFolder) each time, live.
  openFolder(row, rel) {
    const open = this.state.mention;
    if (!open || !row || typeof this.props.listFolder !== 'function') return;
    const ta = this.find1(`textarea[data-mark="${open.markId}"]`), m = ((this.marks || {})[open.page] || []).find((x) => x.id === open.markId);
    if (ta && m) {
      const end = ta.selectionStart;
      if (end > open.start + 1 && ta.value.charAt(open.start) === '@') {
        ta.setRangeText('', open.start + 1, end, 'end');
        m.note = ta.value; this.inkNote(ta); this.fitNote(ta); this.scheduleSave();
      }
      if (document.activeElement !== ta) ta.focus({ preventScroll: true });
    }
    const at = this.mentionKey(open), id = row.id;
    this.setState({ mention: { ...open, query: '' }, browse: { at, row, rel, listing: undefined }, mentionIdx: 0 });
    Promise.resolve().then(() => this.props.listFolder(id, rel)).catch((error) => ({ error: (error && error.message) || 'This folder could not be read' })).then((listing) => {
      const b = this.state.browse;
      if (!this.host.current || !b || b.at !== at || b.row.id !== id || b.rel !== rel) return;
      const next = { ...b, listing: listing || { error: 'This folder could not be read' } };
      this.setState({ browse: next, mentionIdx: firstPick(folderRows({ browse: next, listing: next.listing, query: (this.state.mention || {}).query })) });
    });
  }
  leaveFolder() {
    const b = this.browsing(); if (!b) return;
    const up = parentRel(b.rel);
    if (up == null) this.setState({ browse: null, mentionIdx: 0 }); else this.openFolder(b.row, up);
  }
  // A note that can ask Bart (MATH-27): one on a highlight, with somewhere to send the question. A free note has no passage.
  asksFrom(m) { return typeof this.props.onAsk === 'function' && !!m && Array.isArray(m.rects) && m.rects.length > 0; }
  pageOf(m) { for (const [page, list] of Object.entries(this.marks || {})) if ((list || []).includes(m)) return Number(page); return 0; }
  // The menu's rows: library items, and Bart where it can ask (MATH-27): a highlight's note, at its start. A note does not
  // ask the other agents, make a note, name a workspace or a page the library does not hold.
  mentionList() {
    const open = this.state.mention;
    if (!open || typeof this.props.mentionItems !== 'function') return [];
    const m = ((this.marks || {})[open.page] || []).find((x) => x && x.id === open.markId);
    const browse = this.browsing();
    if (browse) return folderRows({ browse, listing: browse.listing, query: open.query.toLowerCase() });
    const bart = this.asksFrom(m) && !String((m && m.note) || '').slice(0, open.start).trim();
    // Zotero's row (MATH-65 build 2) is the documents' alone: a note mentions library items.
    return (this.props.mentionItems(open.query.toLowerCase()) || []).filter((r) => r && ((r.kind === 'item' && r.row && r.row.id && !r.row.zotero) || (bart && r.kind === 'verb' && r.verb === 'bart')));
  }
  // Keys in a note's field: the menu's first while it is open (↑ ↓ move, Enter or Tab picks, Escape closes it alone),
  // then Enter in a highlight's note that starts with @bart asks (Shift+Enter is a new line), then Escape leaves the note.
  // None reaches the page or the Stage.
  noteKey(ev, ta, m, page) {
    ev.stopPropagation();
    const items = this.state.mention && this.state.mention.markId === m.id ? this.mentionList() : [];
    if (items.length) {
      const n = items.length, open = this.state.mention;
      // Backspace with nothing typed after the `@`, inside a folder: up a level, the `@` kept (MATH-22).
      if (ev.key === 'Backspace' && !open.query && ta.selectionStart === ta.selectionEnd && ta.selectionStart === open.start + 1 && this.browsing()) { ev.preventDefault(); this.leaveFolder(); return; }
      if (ev.key === 'ArrowDown') { ev.preventDefault(); this.setState({ mentionIdx: (this.state.mentionIdx + 1) % n }); return; }
      if (ev.key === 'ArrowUp') { ev.preventDefault(); this.setState({ mentionIdx: (this.state.mentionIdx - 1 + n) % n }); return; }
      if ((ev.key === 'Enter' || ev.key === 'Tab') && !ev.isComposing) { ev.preventDefault(); this.pickMention(items[this.state.mentionIdx] || items[0]); return; }
      if (ev.key === 'Escape') { ev.preventDefault(); this.closeMention(); return; }
    }
    if (ev.key === 'Enter' && !ev.shiftKey && !ev.isComposing && this.asksFrom(m)) {
      const question = noteQuestion(ta.value);
      if (question != null) {
        ev.preventDefault();
        if (question) this.askFrom(ta, m, page || this.pageOf(m), question);
        return;
      }
    }
    if (ev.key === 'Escape') ta.blur();
  }
  // Bart asked from a highlight's note: the passage (all of it, when the highlight is part of a selection across pages),
  // the note as it stands, the question and the highlighted page's text around the passage (pageTextAround) go up (the
  // Stage adds which pdf), with the mark's earlier answers as the turns, deleted ones too while their session lasts
  // (./canvas.js exchangeOf), so a follow-up within half an hour resumes the same session. The note keeps what was typed
  // and shows as text; the answer comes under it in its card.
  askFrom(ta, m, page, question) {
    m.note = ta.value;
    this.flushSave(this.props.onMarksChange);
    this.closeMention();
    const ask = { markId: m.id, page, quote: passageOf(this.marks, m), note: m.note, question, turns: turnsOf(m) };
    if (this.editing === m.id) this.editing = null;
    ta.blur();
    const g = this.geo[page], at = g && g.pageH ? (Number(m.y) * g.pageW) / g.pageH : null;
    return this.pageTextAround(page, m.text, at).then((pageText) => { if (typeof this.props.onAsk === 'function') this.props.onAsk({ ...ask, pageText }); });
  }
  // The text of page n as pdf.js gives it, cut to about 4,000 characters centered on `passage` (./marks.js pageWindow;
  // `at` the share of the page's height it is at, should it not be found). '' when the text cannot be had within 2 s.
  async pageTextAround(n, passage, at = null) {
    let timer = 0;
    try {
      const late = new Promise((_, fail) => { timer = setTimeout(() => fail(new Error('slow')), 2000); });
      return pageWindow(pdfText(await Promise.race([this.texts.get(n), late])), passage, { at });
    } catch {
      return '';
    } finally {
      clearTimeout(timer);
    }
  }
  // A row picked: its token takes the place of `@query`, then a space (one there already is stepped over), and the note
  // keeps the keyboard. The item is only mentioned: nothing is added to the workspace. Bart's row writes `@Bart `.
  pickMention(r) {
    const open = this.state.mention;
    // A library folder, and a subfolder of it, opens in the menu; the back row goes up; a row that only says something is
    // not picked (MATH-22).
    if (r && typeof this.props.listFolder === 'function' && isFolderRow(r)) { this.openFolder(r.row, ''); return; }
    if (r && r.kind === 'entry' && r.dir) { this.openFolder(r.row, r.rel); return; }
    if (r && r.kind === 'back') { this.leaveFolder(); return; }
    if (r && r.kind === 'note') return;
    this.closeMention();
    const bart = !!r && r.kind === 'verb' && r.verb === 'bart';
    if (!open || !r || (!bart && (!r.row || !r.row.id))) return;
    const ta = this.find1(`textarea[data-mark="${open.markId}"]`), m = ((this.marks || {})[open.page] || []).find((x) => x.id === open.markId);
    if (!ta || !m) return;
    if (document.activeElement !== ta) ta.focus({ preventScroll: true });
    const end = ta.selectionStart, found = mentionAt(ta.value, end), start = found ? found.start : open.start;
    if (start > end) return;
    if (bart) {
      ta.setRangeText('@Bart ', start, end, 'end');
      if (ta.value.charAt(ta.selectionEnd) === ' ') ta.setRangeText('', ta.selectionEnd, ta.selectionEnd + 1, 'end');
      m.note = ta.value;
      this.inkNote(ta);
      this.fitNote(ta);
      this.scheduleSave();
      return;
    }
    const file = (r.kind === 'entry' || r.kind === 'self') && r.rel; // a file or a subfolder in a library folder
    ta.setRangeText(file ? fileMention(r.kind === 'self' ? r.entryName : r.name, r.row.id, r.rel) : libMention(r.kind === 'self' ? r.row.name : r.name, r.row.id), start, end, 'end');
    if (ta.value.charAt(ta.selectionEnd) === ' ') ta.setSelectionRange(ta.selectionEnd + 1, ta.selectionEnd + 1);
    else ta.setRangeText(' ', ta.selectionEnd, ta.selectionEnd, 'end');
    m.note = ta.value;
    this.inkNote(ta);
    this.fitNote(ta);
    this.scheduleSave();
  }

  /* ---------------------------------------------------------------- render */
  render() {
    const { title } = this.props;
    const { note, page, pages, pct, removed } = this.state, off = this.state.off || NO_OFF;
    return (
      <div ref={this.root} style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', gap: title ? 12 : 0 }}>
        <style>{LAYER_CSS}</style>
        {title ? (
          <>
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, padding: '14px 20px 0' }}>
              <h3 style={{ margin: 0, font: '600 15px/1.4 var(--font-sans)', color: '#171717', textWrap: 'pretty' }}>{title}</h3>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }} />
          </>
        ) : null}
        <div style={{ position: 'relative', flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
          <div ref={this.host} data-pdf="1" style={{ flex: 1, minHeight: 0, overflow: 'auto', border: 0, borderTop: title ? '1px solid #eaeaea' : 0, borderRadius: 0, background: '#fff', padding: 0 }} />
          {note
            ? <span style={{ position: 'absolute', left: 0, right: 0, top: 14, textAlign: 'center', font: '12px/1.5 var(--font-sans)', color: '#8f8f8f', pointerEvents: 'none' }}>{note}</span>
            : null}
          {!note && SIDES.map((side) => (off[side] ? <div key={`fade-${side}`} data-fade={side} style={fadeStyle(side)} /> : null))}
          {removed ? (
            <div data-removed="1" role="status" style={TOAST} onMouseDown={(e) => e.preventDefault()}>
              <span>{removed.label}</span>
              <span style={{ color: '#8f8f8f' }}>·</span>
              <button type="button" data-removed-undo="1" style={TOAST_UNDO} onClick={() => this.undoRemoval(removed.batch)}>Undo</button>
            </div>
          ) : null}
          {this.state.mention && this.state.mention.anchor ? (
            <MentionMenu items={this.mentionList()} index={this.state.mentionIdx} anchor={this.state.mention.anchor} onPick={(r) => this.pickMention(r)} onHover={(i) => this.setState({ mentionIdx: i })} />
          ) : null}
          {!note && pages > 0 ? (
            <div style={BAR} title="pinch, or ⌘ or ⌃ scroll, to zoom" onMouseDown={(e) => e.preventDefault()}>
              <span style={{ color: '#171717', minWidth: `${String(pages).length}ch`, textAlign: 'right' }}>{page}</span>
              <span style={{ margin: '0 4px', color: '#8f8f8f' }}>of {pages}</span>
              <span style={{ flex: 'none', width: 1, height: 16, margin: '0 6px', background: '#eaeaea' }} />
              <button type="button" className="hov-wash" aria-label="Zoom out" style={BAR_STEP} onClick={() => this.zoomStepBy(-1)}>−</button>
              <button type="button" className="hov-wash" title="100% = fit width" style={BAR_PCT} onClick={() => this.togglePct()}>{pct}%</button>
              <button type="button" className="hov-wash" aria-label="Zoom in" style={BAR_STEP} onClick={() => this.zoomStepBy(1)}>+</button>
            </div>
          ) : null}
        </div>
      </div>
    );
  }
}
