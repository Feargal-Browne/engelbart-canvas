'use strict';

// Send to reMarkable (2026-10-31): a PDF from Engelbart onto the tablet, the way reMarkable supports without its cloud
// or a cable: the official reMarkable app on this Mac imports a file and syncs it to the tablet.
//
// The PDF is copied under the name it should have on the tablet (the app names a document after its file), the app is
// brought up and given the file (macOS's open), and its library (packages/remarkable-bridge's desktop source, the one
// Connect reads) is watched for a new document of that name. The app does not say whether it takes files this way, so
// when nothing has come after WAIT_MS the answer is `drop`: the window offers the file to drag into the app, which is
// the way reMarkable documents, and the library is watched again (awaitDrop) until it comes. Nothing else is written
// anywhere: the reMarkable app does the importing.
//
// What the app makes of it is a document of its own, which Connect would bring back into the library beside the PDF it
// came from: `expect(name, row, source)` (before the app is given it; `row` the library row it is sent from, `source`
// the PDF as it was before Engelbart's highlights were drawn in) and `arrived(entry)` tell ./sync.cjs, which leaves
// that copy out of the library for as long as nobody has written on it, and then puts its ink on that row
// (./rows.cjs), drawn on `source` so Engelbart's highlights are not shown twice there.
//
// The highlights made in Engelbart go to the tablet with it, drawn into its pages (bridge drawHighlights): the
// reMarkable app shows a PDF's pages, not annotations kept beside it. They are as they were when it was sent; sending
// it again takes the ones made since. rowForSend: the library row a PDF is sent from, saved to the library first when
// it is not there, so the tablet's ink has an item to come back to.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { randomUUID } = require('node:crypto');
const { safeName } = require('./sync.cjs');

const APP_ID = 'com.remarkable.desktop';
const WAIT_MS = 15_000; // for the app to import a file it was given
const DROP_WAIT_MS = 5 * 60_000; // for the person to drop it in
const POLL_MS = 1_000;
const MAX_BYTES = 200 * 1024 * 1024;
const KEEP_MS = 24 * 60 * 60_000; // a copy the app was given and not seen to take: kept a day, for dragging in again

class SendError extends Error {
  constructor(message, code = 'send') { super(message); this.code = code; }
}

const isPdf = (bytes) => bytes && bytes.length > 5 && Buffer.from(bytes.subarray(0, Math.min(1024, bytes.length))).includes('%PDF-');

/**
 * A PDF's ink as Engelbart keeps it ({ "<page>": [mark] }, pages from 1, a highlight's `rects` fractions of the page's
 * shown width: src/renderer/pdf/marks.js) → the bridge's highlights ([{ page (from 0), rects }]). A free note (no
 * rects) and anything else that is not a page are left out.
 */
function highlightsOf(marks) {
  const out = [];
  if (!marks || typeof marks !== 'object' || Array.isArray(marks)) return out;
  for (const [key, list] of Object.entries(marks)) {
    const page = Number(key);
    if (!Number.isInteger(page) || page < 1 || !Array.isArray(list)) continue;
    for (const mark of list) {
      const rects = mark && Array.isArray(mark.rects) ? mark.rects.filter((r) => r && [r.x, r.y, r.w, r.h].every(Number.isFinite) && r.w > 0 && r.h > 0) : [];
      if (rects.length) out.push({ page: page - 1, rects: rects.map(({ x, y, w, h }) => ({ x, y, w, h })) });
    }
  }
  return out;
}

const drawWithBridge = (bytes, highlights) => require('remarkable-bridge').drawHighlights(bytes, highlights);

/**
 * The library row a PDF is sent from (`library`: store/library.cjs): `rowId`'s; else the one its address or path is
 * already; else it is saved to the library now, as the Stage's Save keeps it (a copy, for one from the web; the file
 * itself, for one on disk), so what is written on it on the tablet has an item to come back to. → { row, saved }; row
 * null when it cannot be kept (then its copy comes back as an item of its own).
 */
async function rowForSend(ctx, { rowId = null, input = null, bytes, name = null }, { library, inspectPdf = null }) {
  if (rowId) { const row = await ctx.libraryDb.get(rowId); if (row) return { row, saved: false }; }
  const address = typeof input === 'string' ? input.trim() : '';
  if (!address || /^(about|data|blob):/i.test(address)) return { row: null, saved: false };
  try { const { row } = await library.lookupItem(ctx, address); if (row) return { row, saved: false }; } catch { /* not one it can tell */ }
  try {
    const row = /^https?:\/\//i.test(address)
      ? await library.addPdfCopy(ctx, address, bytes, { inspectPdf, name })
      : await library.addItem(ctx, address, { inspectPdf, name });
    return { row, saved: true };
  } catch {
    return { row: null, saved: false };
  }
}

/** Where the reMarkable app is: Spotlight by its bundle id, else /Applications. null when it is not on this Mac. */
function findApp() {
  return new Promise((resolve) => {
    execFile('mdfind', [`kMDItemCFBundleIdentifier == '${APP_ID}'`], { timeout: 5000 }, (error, stdout) => {
      const found = !error && String(stdout).split('\n').map((line) => line.trim()).find((line) => line.endsWith('.app'));
      if (found) return resolve(found);
      for (const dir of ['/Applications', path.join(os.homedir(), 'Applications')]) {
        const app = path.join(dir, 'reMarkable.app');
        if (fs.existsSync(app)) return resolve(app);
      }
      resolve(null);
    });
  });
}

const openWith = (app, file) => new Promise((resolve, reject) => {
  execFile('open', ['-a', app, file], { timeout: 15000 }, (error) => (error ? reject(error) : resolve()));
});

/**
 * `list()`: the reMarkable app's library (the bridge's desktop source list). `findApp()`, `open(app, file)`: injected by
 * the tests. `dir`: where copies to send are kept. `expect(name, row, source)`, `arrived(entry)`: ./sync.cjs's.
 * `draw(bytes, highlights)`: highlights drawn into a PDF (bridge drawHighlights). → { send, awaitDrop, cancel, owns, dir }
 */
function createRemarkableSend({ list, findApp: locate = findApp, open = openWith, expect = () => {}, arrived = () => {}, draw = drawWithBridge, dir = path.join(os.tmpdir(), 'engelbart-to-remarkable'), waitMs = WAIT_MS, dropWaitMs = DROP_WAIT_MS, pollMs = POLL_MS, sleep = (ms) => new Promise((r) => setTimeout(r, ms)), now = () => Date.now() } = {}) {
  /** The ids of every document in the app's library now; null when it cannot be read (then nothing can be confirmed). */
  async function snapshot() {
    try { return new Set((await list()).map((entry) => entry.id)); } catch { return null; }
  }

  // One wait a name: a newer one (the same PDF sent again) or a cancel (the card closed) ends the one before.
  const waits = new Map();

  /** Waits up to `ms` for a document named `name` that was not in `before`. → its entry, or null (also when cancelled). */
  async function arrival(name, before, ms) {
    const until = now() + ms;
    const want = name.normalize('NFC').toLowerCase();
    const mine = {};
    waits.set(want, mine);
    try {
      while (now() < until && waits.get(want) === mine) {
        await sleep(pollMs);
        if (waits.get(want) !== mine) break;
        let entries;
        try { entries = await list(); } catch { continue; }
        const found = entries.find((e) => e.kind === 'document' && !e.trashed && !before.has(e.id) && String(e.name).normalize('NFC').toLowerCase() === want);
        if (found) { try { arrived(found); } catch { /* the sync matches it by name */ } return found; }
      }
      return null;
    } finally {
      if (waits.get(want) === mine) waits.delete(want);
    }
  }

  /** A copy's folder, gone (it has arrived; the app keeps its own). */
  const forget = (file) => { try { fs.rmSync(path.dirname(file), { recursive: true, force: true }); } catch { /* already gone */ } };
  /** Copies older than KEEP_MS, gone. */
  function prune() {
    let names = [];
    try { names = fs.readdirSync(dir); } catch { return; }
    for (const name of names) {
      const at = path.join(dir, name);
      try { if (now() - fs.statSync(at).mtimeMs > KEEP_MS) fs.rmSync(at, { recursive: true, force: true }); } catch { /* in use, or gone */ }
    }
  }

  /**
   * Puts the PDF `bytes` on the tablet as `name`, with the highlights in `marks` (Engelbart's ink for it) drawn in;
   * `from`: the library row it is, or null. → { state: 'sent', name, highlights } once the app has it; { state: 'drop',
   * name, file, highlights } when it did not take it by itself (the window offers `file` to drag into it); { state:
   * 'given', name, highlights } when the app's library cannot be read to tell. `highlights`: how many went with it.
   * Throws SendError (code 'no-app', 'not-pdf', 'too-big').
   */
  async function send({ name, bytes, from = null, marks = null }) {
    const { data, app } = await check(bytes);
    const highlights = highlightsOf(marks);
    let drawn = data;
    if (highlights.length) { try { drawn = await draw(data, highlights); } catch { drawn = data; /* it goes without them */ } }
    const shown = drawn === data ? 0 : highlights.length;
    if (drawn.length > MAX_BYTES) throw new SendError('This PDF is larger than reMarkable takes (200 MB).', 'too-big');
    prune();
    // A name with nothing to keep (only dots or spaces) would be "Untitled", and could be taken for another document.
    const title = /[\p{L}\p{N}]/u.test(String(name || '')) ? safeName(name) : `From Engelbart ${new Date(now()).toISOString().slice(0, 16).replace('T', ' ').replace(':', '.')}`;
    const own = path.join(dir, randomUUID());
    fs.mkdirSync(own, { recursive: true });
    const file = path.join(own, `${title}.pdf`);
    fs.writeFileSync(file, drawn);
    const before = await snapshot();
    const row = typeof from === 'string' && from ? from : null;
    try { expect(title, row, row ? data : null); } catch { /* the copy comes into the library as a document of its own */ }
    await open(app, file);
    if (!before) return { state: 'given', name: title, highlights: shown };
    const came = await arrival(title, before, waitMs);
    if (came) { forget(file); return { state: 'sent', name: title, highlights: shown }; }
    return { state: 'drop', name: title, file, since: [...before], highlights: shown };
  }

  /**
   * Whether `bytes` can be sent (before anything is saved for it): a PDF reMarkable takes, and the reMarkable app here.
   * → { data, app }. Throws SendError (code 'not-pdf', 'too-big', 'no-app').
   */
  async function check(bytes) {
    const data = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes || []);
    if (!isPdf(data)) throw new SendError('Only PDFs can be sent to reMarkable for now.', 'not-pdf');
    if (data.length > MAX_BYTES) throw new SendError('This PDF is larger than reMarkable takes (200 MB).', 'too-big');
    const app = await locate();
    if (!app) throw new SendError('The reMarkable app isn’t on this Mac. Install it from downloads.remarkable.com and sign in, then send again.', 'no-app');
    return { data, app };
  }

  /**
   * After a drop was offered: waits for `name` to come into the app's library; `file`, the copy offered, goes once it
   * has. → { state: 'sent' | 'waited', name }
   */
  async function awaitDrop({ name, since = [], file = null }) {
    const came = await arrival(name, new Set(since), dropWaitMs);
    if (came && file && owns(file)) forget(file);
    return { state: came ? 'sent' : 'waited', name };
  }

  /** Ends the wait for `name` (the card was closed). */
  const cancel = (name) => { waits.delete(String(name || '').normalize('NFC').toLowerCase()); };

  /** Whether `file` is a copy this made (the only files the window may drag out). */
  const owns = (file) => {
    const resolved = path.resolve(String(file || ''));
    return resolved.startsWith(path.resolve(dir) + path.sep) && resolved.endsWith('.pdf') && fs.existsSync(resolved);
  };

  return { send, check, awaitDrop, cancel, owns, dir };
}

module.exports = { createRemarkableSend, rowForSend, highlightsOf, findApp, SendError, WAIT_MS, DROP_WAIT_MS };
