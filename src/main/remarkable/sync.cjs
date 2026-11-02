'use strict';

// reMarkable (2026-10-31): the person's notebooks and annotated PDFs, as files in a library folder of Engelbart's.
//
// Read from the library the official reMarkable app keeps on this Mac (packages/remarkable-bridge findDesktopLibrary:
// ~/Library/Containers/com.remarkable.desktop/…), never from reMarkable's cloud, whose terms forbid other software,
// and never over USB. Nothing is written back there. Connecting needs only that app installed and signed in; macOS
// asks the person once whether Engelbart may read another app's data.
//
// The mirror, <dataRoot>/.remarkable/ (a dot folder: a project is <dataRoot>/<slug>, and one named "reMarkable" must
// never be this):
//   state.json   { v, connected, dir, syncedAt, items: { [id]: { kind, version, dir, base, files, convert } } }
//   library/     the tablet's folders as folders, each document as `<name>.pdf` (ink drawn in: ./convert.cjs) and
//                `<name>.md` (its typed text and highlights, when it has any); an ebook as its `.md` alone
// Each document is a row of the library of its own (./rows.cjs): its PDF (an ebook's `.md`), under its name on the
// tablet, so the library's search, the @ menu, the Stage's paper viewer, workspaces and Bart reach it as any paper.
// A row stays the same row while its document does, renamed or moved on the tablet.
//
// A sync lists the app's library (a stat per file after the first) and converts only documents whose files changed
// since (Entry.version), in a worker thread. A document put in the tablet's trash (or in a folder put there) has its
// copy deleted. One the app simply stops listing is kept, where it was: without a Connect subscription reMarkable's
// cloud, and so its app, keeps only what was used in the last 50 days, and a notebook that ages out must not vanish
// from Engelbart too (nor everything, should the app be signed out). It comes back as itself if the app lists it again. Names: the tablet's, made safe for a file name; two in one folder with the same name are
// "Name" and "Name (2)", and a document keeps the name it was given for as long as it keeps its own. A document that
// cannot be converted keeps its files from before, is named on the row, and is tried again when it changes or once in
// the next run of the app. A PDF nobody wrote on is cloned, not rewritten (./convert.cjs).
// A PDF sent from Engelbart (./send.cjs) comes back as a document of its own: while nobody has written on it, it is
// the PDF it was sent from over again, and is left out of the library; once it has ink or highlights it is converted
// (its pages in the PDF's own order, so each keeps its number) and its ink goes onto the library row it was sent from
// (./rows.cjs), where Engelbart's highlights are. sent.json: which documents those are ({ ids: { [id]: at } }), the row
// each was sent from ({ from: { [id]: row } }), and the names of ones on their way ({ pending: [{ key, at, row }] },
// matched to the first new PDF of that name, kept a week). It stays through a disconnect, as rows.json does.
// When: on connecting, a little after launch, whenever the app's library changes (it is watched while connected; the
// reMarkable app writes there as the tablet syncs), when a window comes to the front after 2 minutes, and every
// 10 minutes. Never two at once; one asked for meanwhile runs after.

const fs = require('node:fs');
const path = require('node:path');
const { Worker } = require('node:worker_threads');
const { convertDocument, CONVERT_VERSION } = require('./convert.cjs');

const VERSION = 1;
const ROWS_FILE = 'rows.json'; // ./rows.cjs's: kept through a disconnect
const SENT_FILE = 'sent.json'; // copies sent from Engelbart: kept through a disconnect
const PENDING_MS = 7 * 24 * 60 * 60_000;
const SLACK_MS = 60_000; // a sent copy's lastModified against the time it was sent: clocks, and the app's own writes
const EVERY_MS = 10 * 60_000;
const STALE_MS = 2 * 60_000;
const NAME_MAX = 120;

const mirrorDir = (dataRoot) => path.join(dataRoot, '.remarkable');
const libraryDir = (root) => path.join(root, 'library');

class RemarkableError extends Error {
  constructor(message, code = 'remarkable') { super(message); this.code = code; }
}

const readJson = (file) => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; } };
function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 1)}\n`);
  fs.renameSync(temporary, file);
}

/**
 * A tablet name as a file name: no slashes or colons, nothing leading or trailing but letters (no `.`, no `..`, no
 * dotfile the @ menu would hide), never empty. A name is the tablet's, so it is never trusted as a path.
 */
function safeName(name) {
  const clean = String(name || '').normalize('NFC').replace(/[/\\:\0-\x1f\x7f]/g, '-').replace(/\s+/g, ' ').slice(0, NAME_MAX)
    .replace(/^[\s.]+/, '').replace(/[\s.]+$/, '');
  return clean || 'Untitled';
}

/** Two names the Mac's disk takes for one file (any case; é typed or é from Finder) have one key. */
const nameKey = (name) => String(name).normalize('NFC').toLowerCase();

/** `rel` inside `library` → its absolute path, or null for one that would leave it. */
function inLibrary(library, rel) {
  const abs = path.resolve(library, rel);
  return abs.startsWith(path.resolve(library) + path.sep) ? abs : null;
}

/**
 * Where each folder and document goes: { [id]: { dir, base } }, `dir` the folder's path inside library/ ('' the top),
 * `base` the file name less its extension (a folder's own name for a folder). What each puts on disk (a folder its
 * name, a document its `.pdf` and `.md`) is unique within its folder as the Mac's disk compares names (nameKey);
 * whoever held a name before keeps it, and `reserved` (kept documents the app no longer lists) hold theirs.
 */
function placeAll(entries, previous, reserved = []) {
  const byId = new Map(entries.map((e) => [e.id, e]));
  const placed = {};
  const taken = new Map(); // dir → Set of nameKeys on disk
  const namesIn = (dir) => taken.get(dir) || taken.set(dir, new Set()).get(dir);
  const onDisk = (kind, base) => (kind === 'folder' ? [base] : [`${base}.pdf`, `${base}.md`]);
  const hold = (dir, names) => { for (const name of names) namesIn(dir).add(nameKey(name)); };
  for (const item of reserved) hold(item.dir, onDisk('document', item.base));
  const claim = (dir, kind, wanted) => {
    for (let n = 1; ; n++) {
      const base = n === 1 ? wanted : `${wanted} (${n})`;
      const names = onDisk(kind, base);
      if (names.every((name) => !namesIn(dir).has(nameKey(name)))) { hold(dir, names); return base; }
    }
  };
  const dirOf = (id, seen = new Set()) => {
    const e = byId.get(id);
    if (!e || e.kind !== 'folder' || seen.has(id)) return null;
    if (placed[id]) return placed[id].dir ? `${placed[id].dir}/${placed[id].base}` : placed[id].base;
    seen.add(id);
    const parent = dirOf(e.parent, seen) ?? '';
    placed[id] = { dir: parent, base: claim(parent, 'folder', safeName(e.name)) };
    return parent ? `${parent}/${placed[id].base}` : placed[id].base;
  };
  // Folders first, then documents; within each, whoever kept its place and name since the last sync first.
  const kept = (e) => { const was = previous[e.id]; return was && was.base === safeName(e.name) ? 0 : 1; };
  const order = (a, b) => kept(a) - kept(b) || a.lastModified - b.lastModified || a.id.localeCompare(b.id);
  for (const e of entries.filter((x) => x.kind === 'folder').sort(order)) dirOf(e.id);
  for (const e of entries.filter((x) => x.kind === 'document').sort(order)) {
    const dir = dirOf(e.parent) ?? '';
    placed[e.id] = { dir, base: claim(dir, 'document', safeName(e.name)) };
  }
  return placed;
}

/** A kept document's record without its mark: the app lists it again. */
const listedAgain = ({ gone: _gone, ...item }) => item;

/** A document's files, relative to library/: its PDF (not for an ebook) and its Markdown. */
const filesOf = (place, fileType) => {
  const stem = place.dir ? `${place.dir}/${place.base}` : place.base;
  return { pdf: fileType === 'epub' ? null : `${stem}.pdf`, md: `${stem}.md` };
};

/**
 * Converts in one worker thread, one document at a time. A worker that never comes up (its file not loadable, as inside
 * a packaged app could be) hands its jobs to this thread, and so do all later ones; one that dies at work fails only
 * its own jobs, and the next job starts another.
 */
function createConverter() {
  let worker = null, broken = false, seq = 0;
  let inline = null; // the AbortController of a conversion in this thread (no worker)
  const here = (job) => { const controller = new AbortController(); inline = controller; return convertDocument(job, { signal: controller.signal }).finally(() => { if (inline === controller) inline = null; }); };
  const waiting = new Map(); // seq → { job, resolve, reject, worker }
  const start = () => {
    const w = new Worker(path.join(__dirname, 'convert.cjs'), { workerData: { remarkableConvert: true } });
    let online = false;
    worker = w;
    w.unref(); // an idle converter never keeps the app (or a script) alive; one at work does (convert)
    w.on('online', () => { online = true; });
    w.on('message', ({ seq: n, ok, result, error, code }) => {
      const entry = waiting.get(n);
      if (!entry) return;
      waiting.delete(n);
      if (![...waiting.values()].some((other) => other.worker === w)) w.unref();
      if (ok) entry.resolve(result); else entry.reject(new RemarkableError(error, code || 'convert'));
    });
    const fail = (error) => {
      if (worker === w) worker = null;
      if (!online) broken = true;
      for (const [n, entry] of waiting) {
        if (entry.worker !== w) continue;
        waiting.delete(n);
        if (!online) here(entry.job).then(entry.resolve, entry.reject);
        else entry.reject(new RemarkableError(error && error.message ? error.message : 'The converter stopped', 'convert'));
      }
    };
    w.on('error', fail);
    w.on('exit', (code) => fail(new Error(`The converter stopped (${code})`)));
  };
  return {
    convert(job) {
      if (broken) return here(job);
      try { if (!worker) start(); } catch { broken = true; return here(job); }
      const w = worker;
      return new Promise((resolve, reject) => { const n = ++seq; waiting.set(n, { job, resolve, reject, worker: w }); w.ref(); w.postMessage({ seq: n, job }); });
    },
    /** Stops the conversion under way, if it is reading handwriting (it rejects, code 'aborted'). */
    abort() { if (worker) worker.postMessage({ abort: true }); if (inline) inline.abort(); },
    stop() { const w = worker; worker = null; if (w) void w.terminate(); if (inline) inline.abort(); },
  };
}

/**
 * `root()`: the mirror's folder (mirrorDir(<dataRoot>)), followed as the data root changes. `source(dir)`: the bridge's
 * folder source for the app's library (the tests' fakes); `findLibrary()`: where that library is (bridge
 * findDesktopLibrary). `convert(job)`: ./convert.cjs, in a worker unless given. `onChange(status)` after each change of
 * status(); `onSynced()` after each sync that finished, before it is said (./rows.cjs brings the library's rows up to
 * it). → { status, connect, disconnect, sync, autoSync, lastSyncAt, clear, watch, stop, expectSent, sentArrived, root,
 * library }
 */
function createRemarkableSync({ root, bridge = null, findLibrary = null, source = null, convert = null, onChange = () => {}, onSynced = async () => {}, onRead = () => {}, handwriting = true, now = () => Date.now() } = {}) {
  const lib = () => bridge || require('remarkable-bridge');
  const find = findLibrary || ((...args) => lib().findDesktopLibrary(...args));
  const makeSource = source || ((dir) => lib().createFolderSource(dir));
  // One source a library folder, kept: it reads each document's metadata once and then only stats, and keeps a
  // document listed while its metadata is caught halfway through a rewrite.
  const sources = new Map();
  const sourceOf = (dir) => sources.get(dir) || sources.set(dir, makeSource(dir)).get(dir);
  const converter = convert ? null : createConverter();
  const convertOne = convert || ((job) => converter.convert(job));
  let running = null, again = false, generation = 0, finishedAt = 0, stopWatching = null;
  const tried = new Set(); // documents converted (or tried) in this run of the app
  const hwTried = new Set(); // documents whose handwriting was read (or tried) in this run
  let reading = false; // readAll is waiting on a reading: what halt() and a new sync() stop
  const stopReading = () => { if (reading && converter) converter.abort(); };
  let state = { state: 'idle', error: '', code: '', problems: [] };
  const rootNow = () => (typeof root === 'function' ? root() : root);
  const changed = () => { try { onChange(status()); } catch { /* a listener never breaks a sync */ } };
  const kept = () => { const at = rootNow(); const s = at ? readJson(path.join(at, 'state.json')) : null; return s && s.v === VERSION ? s : null; };

  /**
   * What the reMarkable row says: { connected, state: 'idle' | 'syncing' | 'reading' | 'synced' | 'error', documents, kept
   * (of those, how many the app no longer has), reading ({ done, of }: documents whose handwriting is being read),
   * syncedAt, error, code ('unavailable': no reMarkable app here; 'permission': macOS said no), problems: [{ name,
   * error }] }.
   */
  function status() {
    const s = kept();
    const connected = !!(s && s.connected);
    const documents = s ? Object.values(s.items || {}).filter((i) => i.kind === 'document' && !(i.sent && !(i.files || []).length)).length : 0;
    const gone = s ? Object.values(s.items || {}).filter((i) => i.kind === 'document' && i.gone).length : 0;
    const shown = state.state === 'idle' && connected && s.syncedAt ? 'synced' : state.state;
    return { connected, state: shown, documents, kept: gone, reading: state.reading || null, syncedAt: (s && s.syncedAt) || '', error: state.error, code: state.code, problems: state.problems, library: connected ? libraryDir(rootNow()) : '' };
  }

  const fail = (error) => {
    const code = error && typeof error.code === 'string' ? error.code : '';
    return { state: 'error', error: words(error), code, problems: [] };
  };

  /** Starts reading the reMarkable app's library: finds it, reads it once (macOS asks for permission here), then syncs. */
  async function connect() {
    const at = rootNow();
    if (!at) throw new RemarkableError('There is no data folder to keep your notebooks in.', 'no-root');
    let dir;
    try {
      dir = await find();
      await sourceOf(dir).list();
    } catch (error) {
      state = fail(error); changed();
      return status();
    }
    const was = kept();
    writeJson(path.join(at, 'state.json'), { v: VERSION, connected: true, dir, syncedAt: '', items: was && was.dir === dir ? was.items || {} : {} });
    fs.mkdirSync(libraryDir(at), { recursive: true });
    state = { state: 'idle', error: '', code: '', problems: [] };
    changed();
    void sync().catch(() => {});
    return status();
  }

  /** Stops syncing and watching, and waits for a sync under way to end: nothing is written after this resolves. */
  async function halt() {
    generation += 1;
    again = false;
    stopReading();
    if (stopWatching) stopWatching();
    if (running) await running.catch(() => {});
  }

  /** Stops, and deletes the copies (the reMarkable app's library is never touched; rows.json stays: clear). */
  async function disconnect() {
    await halt();
    clear();
    return status();
  }

  function clear() {
    generation += 1;
    again = false;
    finishedAt = 0;
    if (stopWatching) stopWatching();
    state = { state: 'idle', error: '', code: '', problems: [] };
    const at = rootNow();
    // The copies go; rows.json (./rows.cjs, which library row each document was) stays, so connecting again brings the
    // same rows back, and with them what was made of them in Engelbart (ink, notes, stars, mentions, workspaces); and
    // sent.json, so a copy sent from Engelbart stays out of the library.
    const removeRoot = () => {
      if (!at) return;
      let names = [];
      try { names = fs.readdirSync(at); } catch { return; }
      for (const name of names) if (name !== ROWS_FILE && name !== SENT_FILE) { try { fs.rmSync(path.join(at, name), { recursive: true, force: true }); } catch { /* already gone */ } }
    };
    removeRoot();
    // A conversion under way writes its files when it ends: they go too.
    if (running) running.then(removeRoot, removeRoot);
    changed();
  }

  /** Brings the folder up to the reMarkable app's library. One at a time; one asked for meanwhile runs after. */
  function sync() {
    // A change while handwriting is being read: the reading stops (what it read is kept) and the change comes first.
    if (running) { again = true; stopReading(); return running; }
    running = (async () => {
      try { do { again = false; await once(); } while (again); } finally { running = null; }
      return status();
    })();
    return running;
  }
  // A sync from the clock, a window come forward or a change: also starts watching again if the watcher stopped.
  const autoSync = () => {
    if (running || !(kept() || {}).connected) return running || Promise.resolve(status());
    if (!stopWatching) watch();
    return sync();
  };

  async function once() {
    const run = generation;
    const s = kept();
    const at = rootNow();
    if (!s || !s.connected || !at) return;
    state = { state: 'syncing', error: '', code: '', problems: [] }; changed();
    try {
      const problems = await pull(s, at, run);
      if (run !== generation) return;
      try { await onSynced(); } catch { /* the library's rows catch up on the next sync */ }
      if (run !== generation) return;
      if (handwriting) {
        state = { state: 'idle', error: '', code: '', problems };
        await readAll(run);
        if (run !== generation) return;
      }
      state = { state: 'idle', error: '', code: '', problems };
    } catch (error) {
      if (run !== generation) return;
      state = fail(error);
    } finally {
      finishedAt = now();
      if (run === generation) changed();
    }
  }

  async function pull(s, at, run) {
    const all = await sourceOf(s.dir).list();
    // A folder put in the trash takes what is in it along: those keep their parent, so the trash is an ancestor's.
    const byId = new Map(all.map((e) => [e.id, e]));
    const trashed = (e, seen = new Set()) => e.trashed || (byId.has(e.parent) && !seen.has(e.id) && trashed(byId.get(e.parent), seen.add(e.id)));
    const entries = all.filter((e) => (e.kind === 'folder' || e.kind === 'document') && !trashed(e));
    const previous = s.items || {};
    // Documents the app no longer lists, though nobody put them in the tablet's trash: kept, where they were.
    const listed = new Set(all.map((e) => e.id));
    const kept = Object.entries(previous).filter(([id, item]) => item.kind === 'document' && !listed.has(id));
    const places = placeAll(entries, previous, kept.map(([, item]) => item));
    const library = libraryDir(at);
    const sent = readSent(at);
    const claims = []; // names on their way matched to their copies here: into sent.json at the end
    /** Whether `e` is a copy sent from Engelbart: known by its id, or the first new PDF of a name on its way. */
    const sentCopy = (e) => {
      if (sent.ids[e.id]) return true;
      if (e.fileType !== 'pdf' || previous[e.id]) return false;
      const i = sent.pending.findIndex((p) => p.key === nameKey(e.name) && (e.lastModified || 0) >= p.at - SLACK_MS);
      if (i < 0) return false;
      const [p] = sent.pending.splice(i, 1);
      sent.ids[e.id] = p.at;
      if (p.row) sent.from[e.id] = p.row;
      claims.push({ id: e.id, ...p });
      return true;
    };
    const items = {};
    const problems = [];
    const live = new Set(); // nameKeys of the files that stay
    const keep = (rel) => live.add(nameKey(rel));
    const exists = (rel) => { const abs = inLibrary(library, rel); return !!abs && fs.existsSync(abs); };
    for (const [id, item] of kept) {
      items[id] = { ...item, gone: item.gone || new Date(now()).toISOString() };
      for (const rel of item.files || []) keep(rel);
    }
    for (const e of entries) {
      if (run !== generation) return problems;
      const place = places[e.id];
      if (e.kind === 'folder') { items[e.id] = { kind: 'folder', name: e.name, dir: place.dir, base: place.base }; continue; }
      const files = filesOf(place, e.fileType);
      const copy = sentCopy(e);
      const from = (copy && sent.from[e.id]) || null; // the library row it was sent from
      // Listed again after the app had stopped listing it: itself again, no longer kept.
      const was = previous[e.id] ? listedAgain(previous[e.id]) : undefined;
      const same = was && was.version === e.version && was.convert === CONVERT_VERSION && was.dir === place.dir && was.base === place.base
        && !!was.sent === copy && (was.from || null) === from && (was.files || []).every(exists);
      if (same) { items[e.id] = { ...was, name: e.name }; for (const rel of was.files) keep(rel); continue; }
      // One that failed as it is now is tried again when it changes, or once in a later run of the app; never on every
      // sync (a big one can take seconds to fail).
      if (was && was.failed && was.failed.version === e.version && was.convert === CONVERT_VERSION && tried.has(e.id)) {
        items[e.id] = { ...was, name: e.name };
        for (const rel of was.files || []) keep(rel);
        problems.push({ name: e.name, error: was.failed.error });
        continue;
      }
      tried.add(e.id);
      try {
        const pdf = files.pdf && inLibrary(library, files.pdf), md = inLibrary(library, files.md);
        if ((files.pdf && !pdf) || !md) throw new RemarkableError('Its name cannot be made into a file name here.', 'name');
        // Handwriting already read (by page) goes in now; what is not is read after, a document at a time (readAll).
        const done = await convertOne({ dir: s.dir, id: e.id, pdf, md, handwriting: handwriting ? 'cached' : false, cacheDir: path.join(at, 'handwriting'), ...(copy ? { unlessUntouched: true } : {}), ...(from ? { order: 'source' } : {}) });
        if (run !== generation) return problems;
        const written = [...(done.pdf ? [files.pdf] : []), ...(done.md ? [files.md] : [])];
        const hw = done.handwriting || {};
        items[e.id] = { kind: 'document', name: e.name, version: e.version, lastModified: e.lastModified, dir: place.dir, base: place.base, files: written, convert: CONVERT_VERSION, hw: hw.supported && hw.unread > 0 ? 'pending' : 'read', ...(copy ? { sent: true } : {}), ...(from ? { from } : {}) };
        for (const rel of written) keep(rel);
      } catch (error) {
        // Its files from before stay as they were.
        problems.push({ name: e.name, error: words(error) });
        items[e.id] = { kind: 'document', version: '', dir: place.dir, base: place.base, ...(was || {}), name: e.name, files: (was && was.files) || [], convert: CONVERT_VERSION, failed: { version: e.version, error: words(error) } };
        for (const rel of items[e.id].files) keep(rel);
      }
    }
    if (run !== generation) return problems;
    // Files of documents put in the tablet's trash, renamed or moved, then folders left empty.
    // Compared as the disk compares names: a rename that only changes case is one file, and stays.
    for (const item of Object.values(previous)) {
      for (const rel of item.files || []) {
        const abs = inLibrary(library, rel);
        if (abs && !live.has(nameKey(rel))) fs.rmSync(abs, { force: true });
      }
    }
    pruneEmpty(library);
    if (claims.length) {
      // Read again: a send may have begun while this ran.
      const now_ = readSent(at);
      for (const c of claims) {
        now_.ids[c.id] = c.at;
        if (c.row) now_.from[c.id] = c.row;
        const i = now_.pending.findIndex((p) => p.key === c.key && p.at === c.at);
        if (i >= 0) now_.pending.splice(i, 1);
      }
      writeJson(path.join(at, SENT_FILE), now_);
    }
    writeJson(path.join(at, 'state.json'), { v: VERSION, connected: true, dir: s.dir, syncedAt: new Date(now()).toISOString(), items });
    return problems;
  }

  /** sent.json, its pending names over a week old let go. */
  function readSent(at) {
    const was = readJson(path.join(at, SENT_FILE)) || {};
    const object = (value) => (value && typeof value === 'object' && !Array.isArray(value) ? value : {});
    const ids = object(was.ids);
    const from = Object.fromEntries(Object.entries(object(was.from)).filter(([, row]) => typeof row === 'string'));
    const pending = (Array.isArray(was.pending) ? was.pending : []).filter((p) => p && typeof p.key === 'string' && now() - p.at < PENDING_MS);
    return { ids, from, pending };
  }

  /**
   * A PDF called `name` is being sent from Engelbart (./send.cjs), from the library row `row` (null: a PDF the library
   * does not hold): the first new PDF of that name is its copy, and its ink goes onto that row.
   */
  function expectSent(name, row = null) {
    const at = rootNow();
    if (!at) return;
    const sent = readSent(at);
    sent.pending.push({ key: nameKey(name), at: now(), ...(typeof row === 'string' && row ? { row } : {}) });
    writeJson(path.join(at, SENT_FILE), sent);
  }

  /** The copy sent as `name` came as the document `id`. */
  function sentArrived({ id, name }) {
    const at = rootNow();
    if (!at || !id) return;
    const sent = readSent(at);
    const i = sent.pending.findIndex((p) => p.key === nameKey(name));
    const p = i < 0 ? null : sent.pending.splice(i, 1)[0];
    sent.ids[id] = p ? p.at : now();
    if (p && p.row) sent.from[id] = p.row;
    writeJson(path.join(at, SENT_FILE), sent);
  }

  /**
   * The second pass: the handwriting of documents converted without it (their pages not read before), read and laid
   * into their PDF and Markdown, newest first, a document at a time. Gives way as soon as another sync is asked for
   * (a change on the tablet): that sync comes first, and this goes on after it. One that cannot be read is tried again
   * when it changes or once in a later run of the app.
   */
  async function readAll(run) {
    const at = rootNow();
    const s0 = kept();
    if (!s0 || !s0.connected || !at) return;
    const library = libraryDir(at);
    const queue = Object.entries(s0.items || {})
      .filter(([id, item]) => item.kind === 'document' && !item.gone && (item.hw === 'pending' || (item.hw === 'failed' && !hwTried.has(id))))
      .sort(([, a], [, b]) => (b.lastModified || 0) - (a.lastModified || 0));
    let done = 0, read = 0;
    for (const [id, item] of queue) {
      if (run !== generation || again) break;
      state = { ...state, state: 'reading', reading: { done, of: queue.length } };
      changed();
      hwTried.add(id);
      const stem = item.dir ? `${item.dir}/${item.base}` : item.base;
      const pdfRel = (item.files || []).find((f) => f.endsWith('.pdf')) || null;
      const pdf = pdfRel && inLibrary(library, pdfRel), md = inLibrary(library, `${stem}.md`);
      let next = { ...item, hw: 'failed' };
      if ((!pdfRel || pdf) && md) {
        reading = true;
        try {
          const out = await convertOne({ dir: s0.dir, id, pdf, md, handwriting: 'all', cacheDir: path.join(at, 'handwriting') });
          next = { ...item, files: [...(out.pdf ? [pdfRel] : []), ...(out.md ? [`${stem}.md`] : [])], hw: 'read' };
          read += 1;
        } catch (error) {
          // Stopped (a disconnect, or a change to sync first): still to be read, and read on from what was kept.
          if (error && error.code === 'aborted') { hwTried.delete(id); break; }
        } finally {
          reading = false;
        }
      }
      if (run !== generation) return;
      const s = kept();
      if (!s || !s.connected || !s.items[id]) return;
      s.items[id] = next;
      writeJson(path.join(at, 'state.json'), s);
      done += 1;
    }
    if (read) { try { onRead(); } catch { /* a listener never breaks a sync */ } }
  }

  /** Syncs whenever the reMarkable app's library changes, while connected. → a function that stops. */
  function watch() {
    if (stopWatching) return stopWatching;
    const s = kept();
    if (!s || !s.connected) return () => {};
    try {
      // A watcher that stops by itself (the folder gone, permission withdrawn) is started again by the next autoSync.
      const stop = sourceOf(s.dir).watch(() => { void autoSync().catch(() => {}); }, () => { stopWatching = null; });
      stopWatching = () => { stop(); stopWatching = null; };
    } catch { stopWatching = null; return () => {}; }
    return stopWatching;
  }

  function lastSyncAt() {
    if (finishedAt) return finishedAt;
    const t = Date.parse((kept() || {}).syncedAt || '');
    return Number.isFinite(t) ? t : 0;
  }

  function stop() {
    if (stopWatching) stopWatching();
    if (converter) converter.stop();
  }

  return { status, connect, disconnect, halt, sync, autoSync, lastSyncAt, clear, watch, stop, expectSent, sentArrived, root: rootNow, library: () => { const at = rootNow(); return at ? libraryDir(at) : null; } };
}

/** Removes folders under `dir` that hold nothing (left by documents that moved or went); never `dir` itself. */
function pruneEmpty(dir) {
  let names;
  try { names = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const entry of names) {
    if (!entry.isDirectory()) continue;
    const sub = path.join(dir, entry.name);
    pruneEmpty(sub);
    try { if (fs.readdirSync(sub).length === 0) fs.rmdirSync(sub); } catch { /* in use, or gone */ }
  }
}

/** An error in words for the row, never a stack. */
function words(error) {
  if (error && error.code === 'unavailable') return 'The reMarkable app isn’t on this Mac. Install it, sign in, and let it sync, then connect again.';
  if (error && error.code === 'permission') return 'macOS didn’t let Engelbart read the reMarkable app’s files. Allow it in System Settings → Privacy & Security, then connect again.';
  return error && error.message ? error.message : 'Your reMarkable notebooks could not be read.';
}

/**
 * Syncs while the app is open, when `connected()`: every `every` ms, and on focus() when the last sync ended over
 * `stale` ms ago. Each goes through autoSync, so one under way is never doubled. → { focus, stop }
 */
function scheduleSyncs(remarkable, { connected, every = EVERY_MS, stale = STALE_MS, now = () => Date.now(), setInterval: startClock = setInterval, clearInterval: stopClock = clearInterval } = {}) {
  const ok = () => { try { return !!connected(); } catch { return false; } };
  const run = () => { if (ok()) void remarkable.autoSync().catch(() => {}); };
  const clock = startClock(run, every);
  if (clock && typeof clock.unref === 'function') clock.unref();
  return {
    focus() { if (ok() && now() - remarkable.lastSyncAt() > stale) run(); },
    stop() { stopClock(clock); },
  };
}

module.exports = { createRemarkableSync, scheduleSyncs, placeAll, safeName, nameKey, inLibrary, mirrorDir, libraryDir, RemarkableError, EVERY_MS, STALE_MS };
