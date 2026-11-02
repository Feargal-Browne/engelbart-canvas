'use strict';

// One reMarkable document made into the files of Engelbart's reMarkable folder (./sync.cjs): `<name>.pdf`, the document
// with its ink drawn in (a notebook's pages, or the PDF's own pages with the ink and highlights over them), and
// `<name>.md`, its typed text and highlights, when it has any. An ebook gets the `.md` alone: its ink follows the
// tablet's own reflow of the book, which cannot be drawn again here.
//
// Read from the reMarkable app's library (`dir`) through packages/remarkable-bridge. Writing a big PDF takes a while
// (a 2 MB, 36-page paper about 70 ms; a textbook seconds), so ./sync.cjs runs this in a worker thread of its own and
// the main process never waits on it; run directly (the tests), it is an ordinary function. Each file is written to a
// temporary name and renamed, so a reader never sees half of one.

const fs = require('node:fs');
const path = require('node:path');
const { isMainThread, parentPort, workerData } = require('node:worker_threads');

/** Bump when what is written changes: every document is converted again on the next sync. 2: handwriting as text. */
const CONVERT_VERSION = 2;

/**
 * Readings of handwriting kept on disk by page digest (`dir`/<digest>.json), so a page is read once while unchanged.
 * A file that cannot be read is no reading: the page is read again.
 */
function diskCache(dir) {
  const file = (digest) => path.join(dir, `${String(digest).replace(/[^0-9a-f]/gi, '')}.json`);
  return {
    get(digest) { try { const lines = JSON.parse(fs.readFileSync(file(digest), 'utf8')); return Array.isArray(lines) ? lines : undefined; } catch { return undefined; } },
    set(digest, lines) { writeAtomic(file(digest), `${JSON.stringify(lines)}\n`); },
  };
}

const temporaryFor = (file) => `${file}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`;
/**
 * The Mac's disk takes "notes.pdf" and "Notes.pdf" for one file, and writing one over the other keeps the old spelling:
 * a document renamed on the tablet only in case has its file renamed first, so the name on disk is the new one.
 */
function matchCase(file) {
  const dir = path.dirname(file), name = path.basename(file);
  let names;
  try { names = fs.readdirSync(dir); } catch { return; }
  const key = name.normalize('NFC').toLowerCase();
  const old = names.find((n) => n !== name && n.normalize('NFC').toLowerCase() === key);
  if (old) { try { fs.renameSync(path.join(dir, old), file); } catch { /* left as it is spelled */ } }
}
function writeAtomic(file, bytes) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  matchCase(file);
  const temporary = temporaryFor(file);
  fs.writeFileSync(temporary, bytes);
  fs.renameSync(temporary, file);
}
/** `from` copied to `file`: a clone on APFS (instant, and no more space until one of them changes). */
function cloneAtomic(from, file) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  matchCase(file);
  const temporary = temporaryFor(file);
  fs.copyFileSync(from, temporary, fs.constants.COPYFILE_FICLONE);
  fs.renameSync(temporary, file);
}

/**
 * `{ dir, id, pdf, md, handwriting, cacheDir, unlessUntouched, order }`: the library folder, the document, the absolute paths
 * to write (`pdf` null for an ebook), and how to read its handwriting: 'all' (what the cache in `cacheDir` lacks is read now),
 * 'cached' (only what the cache has: a sync's first pass, so documents come in fast), or false. `deps.recognize`
 * replaces the Mac's reading (the tests); `deps.signal` stops a reading under way (it rejects, code 'aborted': what
 * was read stays in the cache). `unlessUntouched`: a PDF nobody has written on is not written at all, and its files from
 * before go (a copy sent from Engelbart: ./send.cjs). `order`: 'source' keeps a PDF's pages in its own order, with pages
 * inserted on the tablet after them (bridge documentToPdf), for a copy whose ink goes onto the library row it was sent
 * from, where Engelbart's highlights are kept by page number. → { pdf, md: written?, pages, untouched, handwriting: {
 * pages, unread, supported } }. A `.md` with nothing to say is removed rather than left stale.
 */
async function convertDocument({ dir, id, pdf, md, handwriting = false, cacheDir = null, unlessUntouched = false, order = 'tablet' }, deps = {}) {
  const bridge = require('remarkable-bridge');
  const source = bridge.createFolderSource(dir);
  const bundle = await source.open(id);
  const doc = await bridge.readDocument(bundle);
  const read = handwriting
    ? await bridge.readHandwriting(doc, { mode: handwriting === 'all' ? 'all' : 'cached', ...(cacheDir ? { cache: diskCache(cacheDir) } : {}), ...(deps.recognize ? { recognize: deps.recognize } : {}), ...(deps.signal ? { signal: deps.signal } : {}) })
      .catch((error) => { throw deps.signal && deps.signal.aborted ? Object.assign(new Error('Stopped'), { code: 'aborted' }) : error; })
    : { handwriting: new Map(), pages: 0, unread: 0, supported: false };
  let wrotePdf = false;
  // A PDF nobody wrote on, its pages as they came: the file itself, cloned rather than rewritten (most of a library).
  const original = path.join(dir, `${id}.pdf`);
  const untouched = bundle.content.fileType === 'pdf' && doc.pages.every((p) => !p.page && !p.error && p.ref.sourcePage === p.ref.index)
    && (bundle.content.originalPageCount === null || bundle.content.originalPageCount === doc.pages.length) && fs.existsSync(original);
  if (untouched && unlessUntouched) {
    for (const file of [pdf, md]) if (file) fs.rmSync(file, { force: true });
    return { pdf: false, md: false, pages: doc.pages.length, untouched, handwriting: { pages: read.pages, unread: read.unread, supported: read.supported } };
  }
  if (pdf && untouched) {
    cloneAtomic(original, pdf);
    wrotePdf = true;
  } else if (pdf && bundle.content.fileType !== 'epub') {
    writeAtomic(pdf, await bridge.documentToPdf(doc, { source: await bundle.source(), handwriting: read.handwriting, order: order === 'source' ? 'source' : 'tablet' }));
    wrotePdf = true;
  }
  const text = bridge.documentMarkdown(doc, { handwriting: read.handwriting });
  const said = text.split('\n').slice(1).join('\n').trim(); // past the title
  if (said) writeAtomic(md, `${text}\n`);
  else fs.rmSync(md, { force: true });
  return { pdf: wrotePdf, md: !!said, pages: doc.pages.length, untouched, handwriting: { pages: read.pages, unread: read.unread, supported: read.supported } };
}

// As a worker: one conversion per message, answered with { seq, ok, result } or { seq, ok: false, error }; { abort: true }
// stops the one under way (its reading of handwriting). pdf-lib warns on the console about oddities in the PDFs it
// reads; the worker says nothing (as the main process says nothing).
if (!isMainThread && workerData && workerData.remarkableConvert) {
  for (const level of ['log', 'info', 'warn', 'error', 'debug']) console[level] = () => {};
  let current = null;
  parentPort.on('message', async ({ seq, job, abort }) => {
    if (abort) { if (current) current.abort(); return; }
    const controller = new AbortController();
    current = controller;
    try {
      parentPort.postMessage({ seq, ok: true, result: await convertDocument(job, { signal: controller.signal }) });
    } catch (error) {
      parentPort.postMessage({ seq, ok: false, error: error && error.message ? error.message : String(error), code: error && error.code ? String(error.code) : '' });
    } finally {
      if (current === controller) current = null;
    }
  });
}

module.exports = { convertDocument, CONVERT_VERSION };
