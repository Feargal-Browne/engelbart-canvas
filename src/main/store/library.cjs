'use strict';

// The root library: seeds for test mode, file bytes for papers, PDF annotations, adding by address,
// and the two questions the all-projects screen asks (what a project holds, where an item is held).
// Nothing here copies user files; the seeds are the app's own fixtures (spec §2 #7, #15). The copies
// are of what came without a file: a pdf read from the web and saved (addPdfCopy), a page from the web
// saved from the Stage (addPageCopy), and a picture or a pdf dragged in from a browser (addFileCopy).
// They live in <data root>/assets/pdfs, assets/pages and assets/images; Connect your library's Markdown in assets/md
// (addMarkdownCopy).

const fs = require('node:fs');
const path = require('node:path');
const { randomUUID, createHash } = require('node:crypto');
const { fileURLToPath, pathToFileURL } = require('node:url');
const { DIR_MODE } = require('./home.cjs');
const projects = require('./projects.cjs');
const { LIBRARY_TAGS } = require('./db.cjs');
const { reading } = require('../stage/files.cjs');
const { readHtmlMeta } = require('./page-meta.cjs');
const { WEB, withAsk } = require('../../shared/mark-answers.cjs');
const { CROP_RE, cropNumber, cropsOf, nextCropName, isBox } = require('../browser/boxes.cjs');
const { addressKey, isPreviewAddress } = require('../../shared/address-key.cjs');

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_PDF_BYTES = 200 * 1024 * 1024;

function seedRows(seedDir) {
  return [
    { name: 'How to Teach Programming in the AI Era?', type: 'pdf', path: path.join(seedDir, 'hypocompass.pdf') }, // tagged paper once it is looked into
    { name: 'arXiv 2310.05292', type: 'website', tags: ['paper'], url: 'https://arxiv.org/abs/2310.05292' },
    { name: 'mqo00/hypocompass', type: 'website', tags: ['git'], url: 'https://github.com/mqo00/hypocompass', folder_path: null },
    { name: 'backend/problems', type: 'csv', path: path.join(seedDir, 'problems.csv') },
  ];
}

async function seedIfEmpty(ctx, fixturesDir) {
  const existing = await ctx.libraryDb.list();
  if (existing.length) return 0;
  const seedDir = path.join(ctx.dataRoot, 'seed');
  fs.mkdirSync(seedDir, { recursive: true, mode: DIR_MODE });
  for (const name of ['hypocompass.pdf', 'problems.csv']) {
    const source = path.join(fixturesDir, name);
    const target = path.join(seedDir, name);
    if (!fs.existsSync(target) && fs.existsSync(source)) fs.copyFileSync(source, target);
  }
  let count = 0;
  for (const row of seedRows(seedDir)) {
    if (row.path && !fs.existsSync(row.path)) continue;
    await ctx.libraryDb.insert({ id: randomUUID(), ...row });
    count += 1;
  }
  return count;
}

async function listLibrary(ctx) {
  return ctx.libraryDb.list();
}

async function readLibraryFile(ctx, id) {
  if (typeof id !== 'string' || !UUID_RE.test(id)) throw new TypeError('library id is invalid');
  const row = await ctx.libraryDb.get(id);
  if (!row || !row.path) throw new Error('This item has no local file');
  const file = path.resolve(row.path);
  if (path.extname(file).toLowerCase() !== '.pdf') throw new Error('Only downloaded pdf files open for now');
  if (!file.startsWith(ctx.homeDir + path.sep)) throw new Error('The file is outside your home directory');
  const stat = reading(() => fs.statSync(file));
  if (!stat.isFile() || stat.size > MAX_PDF_BYTES) throw new Error('The file is not a readable pdf');
  const buffer = reading(() => fs.readFileSync(file));
  return { id: row.id, name: row.name, bytes: new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength) };
}

function annotationFile(ctx, id) {
  if (typeof id !== 'string' || !UUID_RE.test(id)) throw new TypeError('library id is invalid');
  return path.join(ctx.dataRoot, 'annotations', `${id}.json`);
}

const readJson = (file) => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; } };

/** A row's ink; for a row with none yet, the ink its pdf got on the Stage before the library held it (by its file, else its address). */
async function readAnnotations(ctx, id) {
  const own = readJson(annotationFile(ctx, id));
  if (own) return own;
  const row = await ctx.libraryDb.get(id);
  if (!row) return null;
  for (const address of inkAddresses(row)) {
    const ink = readJson(pageAnnotationFile(ctx, address));
    if (ink) return ink;
  }
  return null;
}

// Ink is written one change at a time (MATH-27 second pass, 2026-10-06): an answer main puts on a mark itself
// (addMarkAnswer) reads the ink and writes it back, and a save from the Stage must not land between the two.
let inkTurn = Promise.resolve();
function inkInTurn(work) {
  const run = inkTurn.then(work);
  inkTurn = run.catch(() => {});
  return run;
}

async function writeAnnotations(ctx, id, value) {
  return inkInTurn(() => writeJson(annotationFile(ctx, id), value));
}

/**
 * The ink a row reads from elsewhere (filed by its file or address before the library held it: readAnnotations) made
 * its own, so it stays with the row when the row's file changes (a sent PDF's tablet ink: remarkable/rows.cjs).
 * → whether it was written.
 */
async function keepAnnotations(ctx, id) {
  return inkInTurn(async () => {
    const own = annotationFile(ctx, id);
    if (fs.existsSync(own)) return false;
    const held = await readAnnotations(ctx, id);
    return held ? writeJson(own, held) : false;
  });
}

// Ink on a pdf read in the Browser pane (2026-09-22), and on a web page (MATH-54). With the library's row when the
// library holds it (a file, or an address it knows: the Paper pane shows the same ink), else kept by the address the
// library would give it, so a row added later finds it (readAnnotations).
// Since MATH-54 (2026-10-06) an address is filed as addressKey spells it: no #fragment, http or https, www. or not, no
// trailing slash, no utm_* and other tracking parameters. Ink filed before then under the address itself (only its
// #fragment dropped) is still read, and written to the new spelling the next time; no file is renamed. A local server
// or a sandbox preview (isPreviewAddress) is never filed: its address changes from run to run.

/** The address as ink was filed by before MATH-54: as the library spells it, without its #fragment. */
const rawAddress = (url) => String(url || '').replace(/#.*$/, '');

/**
 * What ink is kept by, in the order it is looked for (the first is what it is written under): a file's real path; an address as the library spells it (arXiv's
 * abstract page for its pdf) and filed (addressKey), then as it was filed before. A row with both (a copy saved from the
 * web) answers for its address too. A preview's address is none of them.
 */
function inkAddresses(row) {
  const out = [];
  if (row.path) { try { out.push(pathToFileURL(fs.realpathSync(row.path)).href); } catch { out.push(pathToFileURL(path.resolve(row.path)).href); } }
  if (row.url && !isPreviewAddress(row.url)) out.push(addressKey(row.url), rawAddress(row.url));
  return [...new Set(out.filter(Boolean))];
}

function pageAnnotationFile(ctx, address) {
  return path.join(ctx.dataRoot, 'annotations', 'pages', `${createHash('sha256').update(address).digest('hex')}.json`);
}

/**
 * Where the ink of `input` (an address or a path) is: { id }, the library's row; else { file, older }, the file it is
 * written to and the ones it may have been filed in before, first first; { file: null, older: [] } for a preview.
 */
async function inkPlace(ctx, input) {
  if (isPreviewAddress(input)) return { file: null, older: [] };
  const found = resolveAddition(input, { homeDir: ctx.homeDir });
  const row = sameAs(await ctx.libraryDb.list(), found);
  if (row) return { id: row.id };
  const [file, ...older] = inkAddresses(found).map((address) => pageAnnotationFile(ctx, address));
  return { file: file || null, older };
}

/** The ink kept at a place that is no row: its own file, else the first older one there is. */
const readPlace = (place) => [place.file, ...place.older].filter(Boolean).map(readJson).find(Boolean) || null;

async function readPageAnnotations(ctx, input) {
  const place = await inkPlace(ctx, input);
  return place.id ? readAnnotations(ctx, place.id) : readPlace(place);
}

/** The file ink drawn on `found` before the library held it is in (by its address, either spelling), or null. */
function inkBefore(ctx, found) {
  return inkAddresses(found).map((address) => pageAnnotationFile(ctx, address)).find((file) => fs.existsSync(file)) || null;
}

/** Ink made on `found` while it was only an address becomes row `id`'s, when that has none of its own. */
function carryInk(ctx, found, id) {
  const before = inkBefore(ctx, found);
  const own = annotationFile(ctx, id);
  if (before && !fs.existsSync(own)) { fs.mkdirSync(path.dirname(own), { recursive: true, mode: DIR_MODE }); fs.copyFileSync(before, own); }
}

/**
 * The absolute path of the file a pdf's or a web page's ink is read from (`where`: { rowId } or { url }, as
 * readAnnotations and readPageAnnotations find it): where it would be written when there is none yet; '' for a preview,
 * which keeps none. For @bart (MATH-27), to read again.
 */
async function annotationsFileOf(ctx, where) {
  const place = where && where.rowId ? { id: where.rowId } : await inkPlace(ctx, where && where.url);
  if (!place.id) return [place.file, ...place.older].filter(Boolean).find((file) => fs.existsSync(file)) || place.file || '';
  const own = annotationFile(ctx, place.id);
  if (fs.existsSync(own)) return own;
  const row = await ctx.libraryDb.get(place.id);
  for (const address of row ? inkAddresses(row) : []) if (fs.existsSync(pageAnnotationFile(ctx, address))) return pageAnnotationFile(ctx, address);
  return own;
}

/** → whether it was written: a preview's ink is not (inkPlace). */
async function writePageAnnotations(ctx, input, value) {
  return inkInTurn(async () => {
    const place = await inkPlace(ctx, input);
    const file = place.id ? annotationFile(ctx, place.id) : place.file;
    return file ? writeJson(file, value) : false;
  });
}

/**
 * A finished answer from a highlight's note onto its mark, in the ink kept for its pdf or web page (`where`: { rowId } or
 * { url }, as the Stage keeps it), as the Stage puts it there (shared/mark-answers.cjs withAsk): once, and only while the
 * mark is there. `page` is the pdf page the mark is on; null for a web page's mark (MATH-54), which is in its "web" list.
 * → whether the ink was written.
 */
async function addMarkAnswer(ctx, where, page, markId, entry) {
  return inkInTurn(async () => {
    const place = where && where.rowId ? { id: where.rowId } : await inkPlace(ctx, where && where.url);
    const file = place.id ? annotationFile(ctx, place.id) : place.file;
    if (!file) return false;
    const held = place.id ? await readAnnotations(ctx, place.id) : readPlace(place);
    const marks = held && typeof held === 'object' && !Array.isArray(held) ? held : {};
    const next = withAsk(marks, page, markId, entry);
    if (next === marks) return false;
    return writeJson(file, next);
  });
}

/**
 * A highlight made on a web page (MATH-54 build 2, the Stage's right-click Highlight) added to the end of its ink's "web"
 * list, kept as page ink is (inkPlace: the library's row for a saved page, else the address as addressKey spells it).
 * `url` is where the tab is; `mark` is { id, quote: { exact, prefix, suffix }, note, asks, at }, or a box (MATH-70,
 * browser/boxes.cjs) { id, box, crop, text, note, at } with its picture's PNG bytes as `crop`. → whether it was written:
 * a preview's, or a page the library cannot place (a file outside home), is not.
 */
async function addWebMark(ctx, url, mark, { crop = null } = {}) {
  return inkInTurn(async () => {
    const at = await webInk(ctx, url);
    if (!at) return false;
    const { file, marks, list } = at;
    if (list.some((m) => m && m.id === mark.id)) return false;
    // a box (MATH-70) comes with its picture: written first, and gone again when the mark cannot be
    const picture = crop && crop.length && mark.crop ? cropFile(ctx, mark.crop) : null;
    if (picture) writeCrop(picture, crop);
    try {
      return writeJson(file, { ...marks, [WEB]: [...list, mark] });
    } catch (error) {
      if (picture) fs.rmSync(picture, { force: true });
      throw error;
    }
  });
}

/** The web page `url`'s ink: { file (written to), marks, list (its "web" list) }, or null for a page whose ink is not kept. */
async function webInk(ctx, url) {
  let place;
  try { place = await inkPlace(ctx, url); } catch { return null; }
  const file = place.id ? annotationFile(ctx, place.id) : place.file;
  if (!file) return null;
  const held = place.id ? await readAnnotations(ctx, place.id) : readPlace(place);
  const marks = held && typeof held === 'object' && !Array.isArray(held) ? held : {};
  return { file, marks, list: Array.isArray(marks[WEB]) ? marks[WEB] : [] };
}

// A box's picture (MATH-70, 2026-10-07): <dataRoot>/annotations/crops/<mark id>.png, its mark's `crop` the path relative
// to the annotations folder ("crops/<id>.png", browser/boxes.cjs cropName). Deleted with its mark, never pruned.
// MATH-70 build 2 (2026-10-07): a box resized has a new picture, "crops/<id>-<n>.png" (nextCropName), and the old one stays:
// an answer about the box keeps the picture it was asked about (its ask's `crop`). Every picture of a mark is deleted with
// it, and comes back with Undo.

/** The absolute path of a box's picture from its mark's `crop`, or null for anything that is not "crops/<id>.png". */
function cropFile(ctx, crop) {
  const name = typeof crop === 'string' ? crop.match(CROP_RE) : null;
  return name ? path.join(ctx.dataRoot, 'annotations', 'crops', `${name[1]}.png`) : null;
}

function writeCrop(file, png) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: DIR_MODE });
  const temporary = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, png, { mode: 0o600 });
  fs.renameSync(temporary, file);
}

/**
 * Every picture of mark `mark` there is: those it and its asks name, and any other "crops/<id>-<n>.png" left by a resize
 * nothing answered about. → their crop names, each once.
 */
function picturesOf(ctx, mark) {
  const names = new Set(cropsOf(mark));
  let files = [];
  try { files = fs.readdirSync(path.join(ctx.dataRoot, 'annotations', 'crops')); } catch { files = []; }
  for (const file of files) if (cropNumber(mark.id, `crops/${file}`) >= 0) names.add(`crops/${file}`);
  return [...names];
}

/** Mark `markId` in web page `url`'s "web" list, as kept now, or null. `where` is { url } or { rowId }. */
async function readWebMark(ctx, where, markId) {
  let ink = null;
  try { ink = where && where.rowId ? await readAnnotations(ctx, where.rowId) : await readPageAnnotations(ctx, where && where.url); } catch { ink = null; }
  const list = ink && typeof ink === 'object' && Array.isArray(ink[WEB]) ? ink[WEB] : [];
  return list.find((m) => m && m.id === markId) || null;
}

// What a change to a web mark may set (updateWebMark): its note (a highlight's or a box's), and a box's rectangle and the
// text under it. Its id, its answers and its picture's name are not the caller's to set.
const PATCHABLE = ['note', 'box', 'text'];

/**
 * Mark `markId` of web page `url` with `patch` ({ note, box, text }: what PATCHABLE allows) put on it, and for a box
 * given a new picture (`crop`, PNG bytes) that picture written under the next name (nextCropName) and made its `crop`;
 * the one before stays. → the mark as written, or null when it is not there or the ink is not kept.
 */
async function updateWebMark(ctx, url, markId, patch = {}, { crop = null } = {}) {
  return inkInTurn(async () => {
    const at = await webInk(ctx, url);
    if (!at) return null;
    const index = at.list.findIndex((m) => m && m.id === markId);
    if (index < 0) return null;
    const was = at.list[index];
    const next = { ...was };
    for (const key of PATCHABLE) if (patch && Object.prototype.hasOwnProperty.call(patch, key)) next[key] = patch[key];
    if ('box' in next && !isBox(next)) return null; // a box stays a box
    let picture = null;
    if (crop && crop.length && isBox(was)) {
      next.crop = nextCropName(was);
      picture = cropFile(ctx, next.crop);
      if (picture) writeCrop(picture, crop); else next.crop = was.crop;
    }
    try {
      writeJson(at.file, { ...at.marks, [WEB]: at.list.map((m, i) => (i === index ? next : m)) });
    } catch (error) {
      if (picture) fs.rmSync(picture, { force: true });
      throw error;
    }
    return next;
  });
}

/**
 * Mark `markId` taken out of web page `url`'s "web" list, and every picture of it deleted (picturesOf). → { mark, index,
 * crops ([{ crop, bytes }], for undo; empty without any) }, or null when it is not there or the ink is not kept.
 */
async function removeWebMark(ctx, url, markId) {
  return inkInTurn(async () => {
    const at = await webInk(ctx, url);
    if (!at) return null;
    const index = at.list.findIndex((m) => m && m.id === markId);
    if (index < 0) return null;
    const mark = at.list[index];
    writeJson(at.file, { ...at.marks, [WEB]: at.list.filter((_, i) => i !== index) });
    const crops = [];
    for (const crop of isBox(mark) ? picturesOf(ctx, mark) : []) {
      const file = cropFile(ctx, crop);
      if (!file) continue;
      try { crops.push({ crop, bytes: fs.readFileSync(file) }); } catch { /* not there: nothing to keep */ }
      fs.rmSync(file, { force: true });
    }
    return { mark, index, crops };
  });
}

/** What removeWebMark gave back, put back: the mark at its index (the end, if the list is shorter now) and its pictures. */
async function restoreWebMark(ctx, url, { mark, index, crops = [] } = {}) {
  if (!mark || typeof mark.id !== 'string') return false;
  return inkInTurn(async () => {
    const at = await webInk(ctx, url);
    if (!at || at.list.some((m) => m && m.id === mark.id)) return false;
    for (const { crop, bytes } of Array.isArray(crops) ? crops : []) {
      const file = cropNumber(mark.id, crop) >= 0 ? cropFile(ctx, crop) : null; // only the mark's own
      if (file && bytes && bytes.length) writeCrop(file, bytes);
    }
    const list = [...at.list];
    list.splice(Math.max(0, Math.min(Number(index) || 0, list.length)), 0, mark);
    return writeJson(at.file, { ...at.marks, [WEB]: list });
  });
}

function writeJson(file, value) {
  let text;
  try {
    text = JSON.stringify(value ?? {});
  } catch {
    throw new TypeError('annotations must be JSON-serialisable');
  }
  if (text.length > 20 * 1024 * 1024) throw new TypeError('annotations are too large');
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: DIR_MODE });
  const temporary = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, text, { mode: 0o600 });
  fs.renameSync(temporary, file);
  return true;
}

/* ------------------------------------------------------------ who holds what */

// Attachments live in each workspace's meta.json (`context`), and `library.project_id` is only
// where a row was made, so both directions are derived by scanning the workspaces. The rule is
// projects.holds, the one the catalog uses: an item belongs to a project that made it or that
// has it in a workspace's context.

/** Every project that holds the item: `origin` when it was made there, `workspaces` that have it in context. */
async function projectsForLibraryItem(ctx, itemId) {
  if (typeof itemId !== 'string' || !UUID_RE.test(itemId)) throw new TypeError('library id is invalid');
  const row = await ctx.libraryDb.get(itemId);
  if (!row) throw new Error('Unknown library item');
  const out = [];
  for (const project of projects.projectRecords(ctx)) {
    const workspaces = projects.flattenWorkspaces(project.dir).filter((workspace) => workspace.context.includes(row.id));
    const origin = row.project_id === project.id;
    if (origin || workspaces.length) out.push({ id: project.id, name: project.name, origin, workspaces: workspaces.map((workspace) => ({ id: workspace.id, name: workspace.name, path: workspace.path })) });
  }
  return out;
}

/** Every library row the project holds, each with `origin` and the paths of the workspaces that have it in context. */
async function libraryForProject(ctx, projectId) {
  const project = projects.findProject(ctx, projectId);
  const refs = projects.referencedBy(projects.flattenWorkspaces(project.dir));
  return (await ctx.libraryDb.list())
    .filter((row) => projects.holds(project, refs, row))
    .map((row) => ({ ...row, origin: row.project_id === project.id, workspaces: refs.get(row.id) || [] }));
}

/* -------------------------------------------------------- what search reads inside */

// The sidebar's search, the @ menu and "Add from library" also match what things say (MATH-29, 2026-10-05). The text
// comes here, on its own, when one of them opens: never on the library rows, which go to the renderer on every change.
const MAX_BODY_CHARS = 500_000;
const MAX_BODY_BYTES = MAX_BODY_CHARS * 4; // as many UTF-8 bytes as it can take to make that many characters

/** The start of a text file, at most MAX_BODY_CHARS; '' when it is not there or not a file. */
function readBody(file) {
  let fd = null;
  try {
    fd = fs.openSync(file, 'r');
    const stat = fs.fstatSync(fd);
    if (!stat.isFile()) return '';
    const buffer = Buffer.alloc(Math.min(stat.size, MAX_BODY_BYTES));
    const read = fs.readSync(fd, buffer, 0, buffer.length, 0);
    return buffer.subarray(0, read).toString('utf8').slice(0, MAX_BODY_CHARS);
  } catch {
    return '';
  } finally {
    if (fd !== null) fs.closeSync(fd);
  }
}

/**
 * What the project's things say, for search: `items`, library id → a pdf's kept text (library_text, as the sweep read it)
 * or an md's file (a note, or one added from disk); `workspaces`, workspace id → its workspace.md. The rows are the ones
 * libraryForProject gives; nothing is listed for an empty text or a file that is gone. Each is cut at MAX_BODY_CHARS.
 */
async function bodiesForProject(ctx, projectId) {
  const project = projects.findProject(ctx, projectId);
  const rows = await libraryForProject(ctx, projectId);
  const items = await bodiesOfRows(ctx, rows);
  const workspaces = {};
  for (const workspace of projects.flattenWorkspaces(project.dir)) {
    const text = readBody(path.join(project.dir, workspace.path, 'workspace.md'));
    if (text) workspaces[workspace.id] = text;
  }
  return { items, workspaces };
}

/** What every row of the library says, for the all-projects screen's search (no project, so no workspaces). */
async function bodiesForLibrary(ctx) {
  return { items: await bodiesOfRows(ctx, await ctx.libraryDb.list()), workspaces: {} };
}

async function bodiesOfRows(ctx, rows) {
  const items = Object.fromEntries(await ctx.libraryDb.textsFor(rows.filter((row) => row.type === 'pdf').map((row) => row.id), MAX_BODY_CHARS));
  // A file the library links to is read where it is, as the peek reads it: inside the home directory (or the data root).
  const roots = [ctx.homeDir, ctx.dataRoot].map((dir) => { try { return fs.realpathSync(dir); } catch { return null; } }).filter(Boolean);
  for (const row of rows) {
    if (row.type !== 'md' || !row.path) continue;
    let real;
    try { real = fs.realpathSync(row.path); } catch { continue; }
    if (!roots.some((dir) => inside(real, dir))) continue;
    const text = readBody(real);
    if (text) items[row.id] = text;
  }
  return items;
}

/* ------------------------------------------------------------- repositories */

// A repository is one row whether it arrived by its address or as a clone on disk. What it *is* is
// its GitHub id (`github_id`): a rename or a transfer changes the address and not the id, and a name
// someone else took over is the same address and a different id. `url` is where it is now,
// `folder_path` the clone. A clone says where it came from in its own .git/config, which gives the
// address to ask GitHub about. When GitHub cannot be asked (private repository, offline, not on
// GitHub at all) the address stands in for the id, and the id is taken up the first time it is
// known. "Saved locally" means `folder_path` is set and the folder is still there; deleting the
// folder removes nothing from the library.

// A web address typed without its scheme: a host of dotted labels ending in a letters-only top-level domain, then
// optionally a port and a path. A name that ends like a file (one dot, an extension the library opens) is not one.
const BARE_HOST_RE = /^(?:www\.)?(?:[a-z\d](?:[a-z\d-]{0,61}[a-z\d])?\.)+[a-z]{2,24}(?::\d{1,5})?(?:[/?#]\S*)?$/i;
const FILE_NAME_RE = /^[^./]+\.(?:md|markdown|txt|pdf|html?|png|jpe?g|gif|webp|svg|docx?|pptx?|xlsx?|csv|json|ya?ml|py|js|ts|ipynb|tex|bib|zip)$/i;
const GITHUB_RE = /^(?:https?:\/\/(?:www\.)?github\.com\/|git@github\.com:)([\w.-]+)\/([\w.-]+?)(?:\.git)?(?:[/?#].*)?$/i;
const MAX_GIT_CONFIG_BYTES = 1024 * 1024;

/** `git@host:o/r.git`, `ssh://git@host/o/r`, `git://…`, `https://user:token@host/o/r.git` → `https://host/o/r`. Never keeps credentials. A path or `file:` remote is null. */
function canonicalRemote(remote) {
  const value = String(remote || '').trim();
  const match = value.match(/^(?:https?|ssh|git):\/\/(?:[^@/]+@)?([^/:]+)(?::\d+)?\/(.+)$/i) || value.match(/^(?:[\w.-]+@)?([\w.-]+\.[\w.-]+):(?!\/)(.+)$/);
  if (!match) return null;
  const repo = match[2].replace(/[?#].*$/, '').replace(/\/+$/, '').replace(/\.git$/i, '').replace(/\/+$/, '');
  return repo ? `https://${match[1].toLowerCase().replace(/^www\./, '')}/${repo}` : null;
}

/** What two spellings of one repository share. GitHub owners and names compare without case. */
function repoKey(url) {
  const canonical = canonicalRemote(url);
  if (!canonical) return null;
  return /^https:\/\/github\.com\//.test(canonical) ? canonical.toLowerCase() : canonical;
}

// A worktree's or submodule's `.git` is a file that points at the real git directory.
function gitConfigFile(dir) {
  const dotGit = path.join(dir, '.git');
  const stat = fs.statSync(dotGit);
  if (stat.isDirectory()) return path.join(dotGit, 'config');
  const pointer = fs.readFileSync(dotGit, 'utf8').match(/^gitdir:\s*(.+)$/m);
  if (!pointer) return null;
  const gitDir = path.resolve(dir, pointer[1].trim());
  let common = gitDir;
  try { common = path.resolve(gitDir, fs.readFileSync(path.join(gitDir, 'commondir'), 'utf8').trim()); } catch { common = gitDir; }
  return path.join(common, 'config');
}

/** The remote a clone came from (`origin`, else the first one it has), in the one spelling; null when it has none or is not a clone. */
function readCloneRemote(dir) {
  let text;
  try {
    const file = gitConfigFile(dir);
    if (!file || fs.statSync(file).size > MAX_GIT_CONFIG_BYTES) return null;
    text = fs.readFileSync(file, 'utf8');
  } catch { return null; }
  const remotes = new Map();
  let section = null;
  for (const line of text.split('\n')) {
    const header = line.match(/^\s*\[\s*remote\s+"([^"]+)"\s*\]/);
    if (header) { section = header[1]; continue; }
    if (/^\s*\[/.test(line)) { section = null; continue; }
    const url = section && line.match(/^\s*url\s*=\s*(.+?)\s*$/);
    if (url && !remotes.has(section)) remotes.set(section, url[1]);
  }
  for (const remote of [remotes.get('origin'), ...remotes.values()]) {
    const canonical = canonicalRemote(remote);
    if (canonical) return canonical;
  }
  return null;
}

/** A project's code directory that is a clone of `url`, if one is (the clones Engelbart already knows about without looking around the disk). */
function findProjectClone(ctx, url) {
  const key = repoKey(url);
  if (!key) return null;
  const home = fs.realpathSync(ctx.homeDir);
  for (const project of projects.projectRecords(ctx)) {
    if (!project.directory) continue;
    try {
      const real = fs.realpathSync(project.directory);
      if (real.startsWith(home + path.sep) && repoKey(readCloneRemote(real)) === key) return real;
    } catch { /* not there, not a clone */ }
  }
  return null;
}

const folderThere = (folder) => { try { return !!folder && fs.statSync(folder).isDirectory(); } catch { return false; } };
const fileThere = (file) => { try { return fs.statSync(file).isFile(); } catch { return false; } };

/* ------------------------------------------------------------------- adding */

// One resolver behind every way of adding (the field, a dropped file): an address or a path in,
// a library row out. Files and folders are linked where they are, never copied. `type` is read off
// the thing (a file's extension, `folder`, `website`) and nothing is guessed into it; what can be
// told from the address or from a `.git` goes into `tags`. `note` is never given here: only a note
// written in Engelbart has it (projects.createNote).
const ARXIV_RE = /^(?:arxiv:\s*|https?:\/\/(?:www\.)?arxiv\.org\/(?:abs|pdf)\/)?(\d{4}\.\d{4,5})(?:v\d+)?(?:\.pdf)?\/?$/i;
const DOI_RE = /^(?:doi:\s*|https?:\/\/(?:dx\.)?doi\.org\/)?(10\.\d{4,9}\/\S+)$/i;
const FILE_TYPES = new Map([['.md', 'md'], ['.markdown', 'md'], ['.pdf', 'pdf'], ['.html', 'html'], ['.htm', 'html'], ['.csv', 'csv'], ['.tsv', 'tsv'], ['.json', 'json'], ['.jsonl', 'jsonl'], ['.ndjson', 'jsonl'], ['.parquet', 'parquet'], ['.xlsx', 'xlsx'], ['.docx', 'docx'],
  // a picture on disk is linked where it is, like any file (a pasted one is copied into the project: projects.saveImage)
  ['.png', 'image'], ['.jpg', 'image'], ['.jpeg', 'image'], ['.gif', 'image'], ['.webp', 'image'], ['.heic', 'image'], ['.svg', 'image']]);
const TEXT_TYPES = new Set(['csv', 'tsv', 'json', 'jsonl']); // what the peek can show the first lines of
const tagged = (row, tag) => Array.isArray(row.tags) && row.tags.includes(tag);
// a page the library knows only by its address, no repository and no paper: it names and describes itself (addItem)
// and is the one kind of address the Stage saves as a copy (addPageCopy)
const plainPage = (found) => found.type === 'website' && !found.tags.length;

// The category rules, one set for a thing being added and for a row that is already there
// (recategorize). Bump the number when a rule changes: every installed library then goes through
// the rules once more on its next open, and nothing else about its rows is touched.
const CATEGORY_RULES = 1;

/** What an address says by itself: arXiv and DOI are papers, a GitHub repository is a repository. */
function addressTags(url) {
  const value = String(url || '');
  if (ARXIV_RE.test(value) || DOI_RE.test(value)) return ['paper'];
  return GITHUB_RE.test(value) ? ['git'] : [];
}

/** What a row is, from where it is: a file's format, else a folder, else an address. A format the rules do not name keeps the type it has. */
function typeOfRow(row) {
  if (row.path) return FILE_TYPES.get(path.extname(row.path).toLowerCase()) || row.type;
  if (row.folder_path) return 'folder';
  return row.url ? 'website' : row.type;
}

function resolveAddition(input, { homeDir }) {
  if (typeof input !== 'string' || input.length > 4096 || input.includes('\0')) throw new TypeError('Paste a link or a path');
  let value = input.trim().replace(/^["'](.*)["']$/, '$1').trim();
  if (!value) throw new TypeError('Paste a link or a path');
  // A bare address (github.com, example.org/page): an https link, unless it reads as a file's name (notes.md, paper.pdf).
  if (BARE_HOST_RE.test(value) && !FILE_NAME_RE.test(value)) value = `https://${value}`;
  let match;
  const address = (name, url) => ({ type: 'website', tags: addressTags(url), name, url });
  if ((match = value.match(ARXIV_RE))) return address(`arXiv ${match[1]}`, `https://arxiv.org/abs/${match[1]}`);
  if ((match = value.match(DOI_RE))) return address(`doi ${match[1]}`, `https://doi.org/${match[1]}`);
  if ((match = value.match(GITHUB_RE))) return address(`${match[1]}/${match[2]}`, `https://github.com/${match[1]}/${match[2]}`);
  // any other spelling of a remote (ssh://, git://, git@host:group/tool.git, https://host/tool.git)
  if (/^(?:ssh|git):\/\/|^[\w.-]+@[\w.-]+:|^https?:\/\/\S+\.git\/?$/i.test(value) && canonicalRemote(value)) {
    const url = canonicalRemote(value);
    const github = url.match(GITHUB_RE);
    return { type: 'website', tags: ['git'], name: github ? `${github[1]}/${github[2]}` : url.replace(/^https:\/\/[^/]+\//, ''), url };
  }
  if (/^https?:\/\//i.test(value)) {
    let url;
    try { url = new URL(value); } catch { throw new TypeError('That link is not a valid address'); }
    const shown = (url.host.replace(/^www\./, '') + url.pathname).replace(/\/+$/, '');
    return { type: 'website', tags: [], name: shown.slice(0, 200), url: url.href };
  }
  if (/^file:\/\//i.test(value)) value = fileURLToPath(value);
  if (value === '~' || value.startsWith('~/')) value = path.join(homeDir, value.slice(1));
  if (!path.isAbsolute(value)) throw new TypeError('Paste a link, or a path that starts with / or ~/');
  let resolved;
  try { resolved = fs.realpathSync(value); } catch { throw new Error('Nothing is at that path'); }
  const homeReal = fs.realpathSync(homeDir);
  if (!resolved.startsWith(homeReal + path.sep)) throw new Error('Only files inside your home directory can be added');
  const stat = fs.statSync(resolved);
  const base = path.basename(resolved);
  const extension = path.extname(resolved).toLowerCase();
  if (stat.isDirectory()) {
    if (!fs.existsSync(path.join(resolved, '.git'))) return { type: 'folder', tags: [], name: base, folder_path: resolved };
    // a clone is the same repository as its address: same name, and the address comes with it
    const url = readCloneRemote(resolved);
    const github = url && url.match(GITHUB_RE);
    return { type: 'folder', tags: ['git'], name: github ? `${github[1]}/${github[2]}` : base, folder_path: resolved, ...(url ? { url } : {}) };
  }
  if (!stat.isFile()) throw new Error('That is not a file or a folder');
  const type = FILE_TYPES.get(extension);
  if (type === 'pdf') return { type, tags: [], name: path.basename(resolved, path.extname(resolved)), path: resolved }; // whether it is a paper is for whoever reads it (addItem's inspectPdf)
  if (type === 'html') return { type, tags: [], name: base, path: resolved, url: pathToFileURL(resolved).href };
  if (type) return { type, tags: [], name: base, path: resolved };
  throw new Error(`Engelbart does not know what a ${extension || 'file without an extension'} is yet`);
}

/**
 * The row that already is what `found` (resolveAddition's answer) names, or null. A repository is
 * one row whatever its spelling: the same GitHub id (`who`, when GitHub was asked) is the same
 * repository; without an id on both sides the address decides (a clone added before remotes were
 * read has no url: it is read now) — but never against a row that has a *different* id: that name
 * was taken over. Anything else is the same file, the same folder, or the same address.
 */
function sameAs(rows, found, who = null) {
  if (tagged(found, 'git') && found.url) {
    const key = repoKey(found.url);
    const addressOf = (row) => repoKey(row.url || (row.folder_path ? readCloneRemote(row.folder_path) : null));
    const repo = (who && rows.find((row) => row.github_id === who.id))
      || rows.find((row) => tagged(row, 'git') && (!who || !row.github_id) && addressOf(row) === key);
    if (repo) return repo;
  }
  // A repository with an id was matched by it above; an address equal to another row's is then a different repository.
  // One page however it is spelled (shared/address-key.cjs: http or https, www., a trailing slash, a #fragment, utm_*…).
  const page = !found.path && !found.folder_path && !found.github_id && found.url ? addressKey(found.url) : null;
  // (a row with a file answers for its address too: a pdf saved from the web keeps where it came from, 2026-09-23)
  return rows.find((row) => (found.path && row.path === found.path) || (found.folder_path && row.folder_path === found.folder_path) || (page && row.url && addressKey(row.url) === page)) || null;
}

/**
 * A repository that is already a row can still teach the row something when its other half is
 * added: the clone of a row known by its address (or the address of a clone), the id GitHub gives
 * it, the name it has since a rename, the place a moved clone is now (spec §2 #56, #57). A name
 * given by hand is kept: only a name that was the old owner/name is brought up to date.
 */
async function learnRepo(ctx, repo, found, who) {
  const was = repo.url && repo.url.match(GITHUB_RE);
  const next = {
    name: who && was && repo.name.toLowerCase() === `${was[1]}/${was[2]}`.toLowerCase() ? who.fullName : repo.name,
    url: who ? who.url : (repo.url || found.url),
    folder_path: found.folder_path && (!folderThere(repo.folder_path) || repo.folder_path === found.folder_path) ? found.folder_path : repo.folder_path,
    github_id: repo.github_id || (who ? who.id : null),
  };
  const learned = Object.keys(next).some((field) => (next[field] || null) !== (repo[field] || null));
  return learned ? ctx.libraryDb.updateRepo(repo.id, next) : repo;
}

/** What adding something the library already holds throws. The message names the row as the library calls it. */
function alreadyThere(row) {
  const error = new Error(`Already in the library as “${row.name}”`);
  error.code = 'EXISTS';
  error.row = row;
  return error;
}

/**
 * What an address or a path would be in the library, asked without adding it and without the
 * network: `row`, the row that already is that thing, or null; `found`, what the resolver makes of
 * it; `error`, why it cannot be added (nothing at that path, a format Engelbart does not read). The
 * Browser's Save button and the sidebar's search ask this.
 */
async function lookupItem(ctx, input) {
  let found;
  try { found = resolveAddition(input, { homeDir: ctx.homeDir }); } catch (error) { return { row: null, found: null, error: error.message }; }
  return { row: sameAs(await ctx.libraryDb.list(), found), found, error: null };
}

/**
 * Adds what the address or path names as a new row. Something the library already holds is not
 * added twice: that throws (`code: 'EXISTS'`, "Already in the library as “…”", 2026-09-22). The
 * only thing such an add still does is what learnRepo says: a repository's row learns its clone,
 * its id or its new name, since that is the same row knowing more, not a second one.
 * A page is asked for its own title and description (`describe`), a GitHub repository for who it
 * is (`identifyRepo`), both best effort; the description becomes the row's summary. A pdf is read
 * for whether it is a paper (`inspectPdf`, which answers with its tags); one that cannot be read is
 * added all the same and left due for recategorize. `name`, when given, is what the row is called
 * (the Browser's Save card lets the person name the page).
 */
async function addItem(ctx, input, { describe, identifyRepo, inspectPdf, name: given = null } = {}) {
  const found = resolveAddition(input, { homeDir: ctx.homeDir });
  const rows = await ctx.libraryDb.list();
  let about = null, who = null;
  if (tagged(found, 'git') && found.url) {
    const github = found.url.match(GITHUB_RE);
    if (github && identifyRepo) { try { who = await identifyRepo(github[1], github[2]); } catch { who = null; } }
    if (who) Object.assign(found, { github_id: who.id, url: who.url, name: who.fullName });
  }
  const same = sameAs(rows, found, who);
  if (same) throw alreadyThere(tagged(found, 'git') && tagged(same, 'git') ? await learnRepo(ctx, same, found, who) : same);
  if (tagged(found, 'git') && found.url) {
    if (!found.folder_path) {
      found.folder_path = findProjectClone(ctx, found.url);
      if (found.folder_path) found.type = 'folder'; // a repository that has a folder is a folder (db.updateRepo keeps the same rule)
    }
    if (who) about = { title: '', description: who.description };
  }
  const page = plainPage(found);
  if (describe && page) {
    try { about = await describe(found); } catch { about = null; }
  }
  const title = about && typeof about.title === 'string' ? about.title.replace(/\s+/g, ' ').trim().slice(0, 200) : '';
  const named = typeof given === 'string' ? given.replace(/\s+/g, ' ').trim().slice(0, 200) : '';
  // Everything but a pdf is fully categorized by the resolver; a pdf is once it has been read.
  let row = await ctx.libraryDb.insert({ id: randomUUID(), name: named || (page && title ? title : found.name), type: found.type, tags: found.tags, path: found.path || null, url: found.url || null, folder_path: found.folder_path || null, project_id: null, github_id: found.github_id || null, categorized: found.type === 'pdf' ? null : CATEGORY_RULES });
  if (inspectPdf && row.type === 'pdf') {
    try { row = await ctx.libraryDb.setCategory(row.id, { type: row.type, tags: await inspectPdf(row.path) }, CATEGORY_RULES); } catch { /* not readable now: recategorize tries again */ }
  }
  const description = about && typeof about.description === 'string' ? about.description.replace(/\s+/g, ' ').trim().slice(0, 1200) : '';
  if (description) return ctx.libraryDb.setSummary(row.id, description, new Date());
  return row;
}

/** Bytes that are a pdf: `%PDF-` within the first 1024, as readers allow. */
function isPdfBytes(bytes) {
  if (!(bytes instanceof Uint8Array) || !bytes.byteLength) return false;
  return Buffer.from(bytes.buffer, bytes.byteOffset, Math.min(1024, bytes.byteLength)).toString('latin1').includes('%PDF-');
}

/** Where a row's saved pdf lives, written whole or not at all: <data root>/assets/pdfs/<id>.pdf. */
function writePdfCopy(ctx, id, bytes) {
  if (typeof id !== 'string' || !UUID_RE.test(id)) throw new TypeError('library id is invalid');
  const dir = path.join(ctx.dataRoot, 'assets', 'pdfs');
  fs.mkdirSync(dir, { recursive: true, mode: DIR_MODE });
  const file = path.join(dir, `${id}.pdf`);
  const temporary = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, bytes, { mode: 0o600 });
  fs.renameSync(temporary, file);
  return file;
}

/**
 * A pdf read from the web, saved as itself (2026-09-23, Hudson: "save the PDF then instead of just saving the website"):
 * the bytes the Stage drew go to <data root>/assets/pdfs/<id>.pdf and the row is a `pdf` whose `path` is that copy and
 * whose `url` is where it came from (an arXiv or DOI address as the library spells it, `paper` kept). Something the
 * library already holds by that address throws EXISTS, as addItem does. Ink drawn before saving comes along.
 */
async function addPdfCopy(ctx, input, bytes, { inspectPdf, name: given = null } = {}) {
  if (typeof input !== 'string' || !/^https?:\/\//i.test(input.trim())) throw new TypeError('Only a pdf from the web is saved as a copy');
  if (!isPdfBytes(bytes)) throw new TypeError('That is not a pdf');
  if (bytes.byteLength > MAX_PDF_BYTES) throw new Error('The pdf is larger than 200 MB');
  const found = resolveAddition(input, { homeDir: ctx.homeDir });
  const same = sameAs(await ctx.libraryDb.list(), found);
  if (same) throw alreadyThere(same);
  const id = randomUUID();
  const file = writePdfCopy(ctx, id, bytes);
  let fromAddress = '';
  try { fromAddress = decodeURIComponent(new URL(input.trim()).pathname.split('/').pop() || '').replace(/\.pdf$/i, ''); } catch { fromAddress = ''; }
  const named = typeof given === 'string' ? given.replace(/\s+/g, ' ').trim().slice(0, 200) : '';
  let row;
  try {
    row = await ctx.libraryDb.insert({ id, name: named || fromAddress.slice(0, 200) || found.name, type: 'pdf', tags: found.tags, path: file, url: found.url, folder_path: null, project_id: null, github_id: null, categorized: null });
  } catch (error) {
    fs.rmSync(file, { force: true });
    throw error;
  }
  // ink made on it while it was only an address becomes the row's
  carryInk(ctx, found, id);
  if (inspectPdf) {
    try { row = await ctx.libraryDb.setCategory(id, { type: 'pdf', tags: [...new Set([...found.tags, ...(await inspectPdf(file))])] }, CATEGORY_RULES); } catch { /* not readable now: recategorize tries again */ }
  }
  return row;
}

/**
 * A page from the web saved as itself (MATH-17, 2026-10-05), so it opens with no network and as it was when it was read,
 * signed in or not. `save(dir)` writes what the Stage's tab shows into dir (views.savePage: index.html and its files
 * folder) and answers { url, title }. The folder is <data root>/assets/pages/<id>/; the row is an `html` whose `path` is
 * its index.html and whose `url` is where it came from, which answers for it (sameAs). Only a plain page is kept this way:
 * a repository or a paper is added as addItem adds it. Something the library already holds by that address throws
 * EXISTS before anything is written; a save that fails, a tab that has moved to another page, or a row that cannot be
 * written leaves no folder. Named `name`, else the page's title, else its address. Ink drawn before saving comes along.
 */
async function addPageCopy(ctx, input, save, { name: given = null } = {}) {
  if (typeof input !== 'string' || !/^https?:\/\//i.test(input.trim())) throw new TypeError('Only a page from the web is saved as a copy');
  const found = resolveAddition(input, { homeDir: ctx.homeDir });
  if (!plainPage(found)) throw new TypeError('Only a plain web page is saved as a copy');
  const same = sameAs(await ctx.libraryDb.list(), found);
  if (same) throw alreadyThere(same);
  const id = randomUUID();
  const pages = path.join(ctx.dataRoot, 'assets', 'pages');
  fs.mkdirSync(pages, { recursive: true, mode: DIR_MODE });
  // by its real path, as the resolver gives a file: the copy open in the Stage is found as this row
  const dir = path.join(fs.realpathSync(pages), id);
  const file = path.join(dir, 'index.html');
  fs.mkdirSync(dir, { mode: DIR_MODE });
  let row;
  try {
    const saved = await save(dir);
    if (!saved || addressKey(saved.url) !== addressKey(found.url)) throw new Error('The page changed before it was saved. Save it again.');
    if (!fileThere(file)) throw new Error('The page was not saved');
    const clean = (value) => (typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, 200) : '');
    row = await ctx.libraryDb.insert({ id, name: clean(given) || clean(saved.title) || found.name, type: 'html', tags: [], path: file, url: found.url, folder_path: null, project_id: null, github_id: null, categorized: CATEGORY_RULES });
  } catch (error) {
    fs.rmSync(dir, { recursive: true, force: true });
    throw error;
  }
  // ink made on it while it was only an address becomes the row's, as addPdfCopy does
  carryInk(ctx, found, id);
  // the description the page gives of itself, as addItem asks a page for one: read from the copy, not the network
  const { description } = readHtmlMeta(readBody(file));
  const summary = description.replace(/\s+/g, ' ').trim().slice(0, 1200);
  return summary ? ctx.libraryDb.setSummary(id, summary, new Date()) : row;
}

/**
 * A Markdown text kept as a file of the library's own (2026-10-08, Connect your library: "save the imported content not as
 * notes but as md files ... saved as files in the engelbart assets folder"): <data root>/assets/md/<id>/<name>.md, its
 * pictures beside it, and a row of type `md` with no `note` tag and no project. `pictures` [{ file, name }] are copied in
 * as `name` (the text links them by that name). A row that cannot be written leaves no folder. → the row
 */
async function addMarkdownCopy(ctx, { name, text, pictures = [] } = {}) {
  const title = String(name == null ? '' : name).replace(/[\x00-\x1f\x7f]/g, '').replace(/\s+/g, ' ').trim().slice(0, 200) || 'Untitled';
  const stem = title.replace(/[/\\:]/g, '-').replace(/^\.+/, '').trim() || 'Untitled';
  const id = randomUUID();
  const base = path.join(ctx.dataRoot, 'assets', 'md');
  fs.mkdirSync(base, { recursive: true, mode: DIR_MODE });
  // by its real path, as the resolver gives a file: the copy open in the Stage is found as this row
  const dir = path.join(fs.realpathSync(base), id);
  fs.mkdirSync(dir, { mode: DIR_MODE });
  const file = path.join(dir, `${stem}.md`);
  try {
    for (const picture of pictures) fs.copyFileSync(picture.file, path.join(dir, path.basename(picture.name)));
    fs.writeFileSync(file, String(text == null ? '' : text), { mode: 0o600 });
    return await ctx.libraryDb.insert({ id, name: title, type: 'md', tags: [], path: file, url: null, folder_path: null, project_id: null, github_id: null, categorized: CATEGORY_RULES });
  } catch (error) {
    fs.rmSync(dir, { recursive: true, force: true });
    throw error;
  }
}

/* ---------------------------------------------------- dragged in (MATH-19) */

// What is dragged onto the library or a workspace from Finder, Chrome or Safari (2026-10-05). A file with a path is
// linked where it is (addItem). Bytes with no path (a picture or a pdf a browser hands over, a file Finder gives no
// path for) are kept as a copy, as addPdfCopy keeps a pdf from the web: a pdf in <data root>/assets/pdfs, a picture in
// <data root>/assets/images. A link is read here first (addFromUrl): a picture or a pdf is kept as a copy, anything
// else becomes the row + Add would make of it. Every such row is the library's, not a project's (`project_id` null),
// unlike a picture pasted into a document (projects.saveImage).
const IMAGE_MIMES = Object.freeze({ 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp' });
const PDF_MIMES = new Set(['application/pdf', 'application/x-pdf']);
const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
const DOWNLOAD_TIMEOUT_MS = 60_000;
// what a server that picks a format by Accept is asked for: the pictures kept here before any other (no avif, no heic)
const DOWNLOAD_ACCEPT = 'image/png,image/jpeg,image/gif,image/webp,application/pdf;q=0.9,*/*;q=0.8';

const mimeOf = (value) => String(value || '').toLowerCase().split(';')[0].trim();

/** Which picture the bytes are by their first bytes (png, jpeg, gif or webp), whatever they were said to be; null for anything else. */
function imageMimeOf(bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.byteLength < 3) return null;
  const head = Buffer.from(bytes.buffer, bytes.byteOffset, Math.min(12, bytes.byteLength));
  const text = head.toString('latin1');
  if (text.startsWith('\x89PNG\r\n\x1a\n')) return 'image/png';
  if (head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) return 'image/jpeg';
  if (/^GIF8[79]a/.test(text)) return 'image/gif';
  if (text.startsWith('RIFF') && text.slice(8, 12) === 'WEBP') return 'image/webp';
  return null;
}

/** Where a row's kept picture lives, written whole or not at all: <data root>/assets/images/<id>.<ext>. */
function writeImageCopy(ctx, id, bytes, extension) {
  if (typeof id !== 'string' || !UUID_RE.test(id)) throw new TypeError('library id is invalid');
  const dir = path.join(ctx.dataRoot, 'assets', 'images');
  fs.mkdirSync(dir, { recursive: true, mode: DIR_MODE });
  const file = path.join(dir, `${id}.${extension}`);
  const temporary = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, bytes, { mode: 0o600 });
  fs.renameSync(temporary, file);
  return file;
}

/** An address a copy came from, as the library spells it. A file inside a GitHub repository (…/raw/…) is that file, not the repository. */
function copiedFrom(ctx, input) {
  if (typeof input !== 'string' || !/^https?:\/\//i.test(input.trim())) throw new TypeError('Only an address from the web is kept with a copy');
  const found = resolveAddition(input, { homeDir: ctx.homeDir });
  return tagged(found, 'git') ? { type: 'website', tags: [], name: found.name, url: new URL(input.trim()).href } : found;
}

/** The last part of an address's path, decoded: "Retrieval%20Study.pdf" → "Retrieval Study.pdf"; '' when it has none. */
function lastSegment(url) {
  try { return decodeURIComponent(new URL(url).pathname.split('/').pop() || ''); } catch { return ''; }
}

/**
 * A dropped picture or pdf saved as a copy, a new row of the library's own. `mime` says which: png, jpeg, gif or webp (a
 * picture, at most 20 MB, its format read from its bytes) or pdf (as addPdfCopy takes one, at most 200 MB, read for
 * whether it is a paper by `inspectPdf`). `url`, when given, is where it came from: kept on the row, and something the
 * library already holds by that address throws EXISTS, as addItem does. Named `name`, else after the address's last
 * part, else "Image" (a pdf with neither: the name its address would get). A row that cannot be written leaves no file.
 */
async function addFileCopy(ctx, { bytes, mime, name: given = null, url = null } = {}, { inspectPdf } = {}) {
  if (!(bytes instanceof Uint8Array) || !bytes.byteLength) throw new TypeError('The file is empty');
  const said = mimeOf(mime);
  const pdf = PDF_MIMES.has(said);
  if (!pdf && !IMAGE_MIMES[said]) throw new TypeError('Only png, jpeg, gif and webp images and pdfs can be added this way');
  let image = null;
  if (pdf) {
    if (bytes.byteLength > MAX_PDF_BYTES) throw new Error('The pdf is larger than 200 MB');
    if (!isPdfBytes(bytes)) throw new TypeError('That is not a pdf');
  } else {
    if (bytes.byteLength > MAX_IMAGE_BYTES) throw new Error('The image is larger than 20 MB');
    image = imageMimeOf(bytes);
    if (!image) throw new TypeError('That is not a png, jpeg, gif or webp image');
  }
  // A pdf takes the address as the library spells it, with what it says (an arXiv pdf is the paper its abstract names);
  // a picture keeps the address it was given.
  const from = url == null ? null : copiedFrom(ctx, url);
  const found = from && !pdf ? { type: 'image', tags: [], url: new URL(url.trim()).href } : from;
  if (found) {
    const same = sameAs(await ctx.libraryDb.list(), found);
    if (same) throw alreadyThere(same);
  }
  const id = randomUUID();
  const file = pdf ? writePdfCopy(ctx, id, bytes) : writeImageCopy(ctx, id, bytes, IMAGE_MIMES[image]);
  const bare = (value) => (pdf ? value.replace(/\.pdf$/i, '') : value).replace(/\s+/g, ' ').trim().slice(0, 200);
  const named = (typeof given === 'string' ? bare(given) : '') || (found ? bare(lastSegment(found.url)) : '') || (pdf ? (found && found.name) || 'Untitled pdf' : 'Image');
  const tags = found ? found.tags : [];
  let row;
  try {
    row = await ctx.libraryDb.insert({ id, name: named, type: pdf ? 'pdf' : 'image', tags, path: file, url: found ? found.url : null, folder_path: null, project_id: null, github_id: null, categorized: pdf ? null : CATEGORY_RULES });
  } catch (error) {
    fs.rmSync(file, { force: true });
    throw error;
  }
  if (pdf && found) {
    // ink made on it while it was only an address becomes the row's, as addPdfCopy does
    carryInk(ctx, found, id);
  }
  if (pdf && inspectPdf) {
    try { row = await ctx.libraryDb.setCategory(id, { type: 'pdf', tags: [...new Set([...tags, ...(await inspectPdf(file))])] }, CATEGORY_RULES); } catch { /* not readable now: recategorize tries again */ }
  }
  return row;
}

/** A body read whole, or a refusal past `max` bytes. */
async function readCapped(response, max, tooLarge) {
  if (!response.body) return new Uint8Array(0);
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > max) { await reader.cancel().catch(() => {}); throw Object.assign(new Error(tooLarge), { code: 'TOO_LARGE' }); }
    chunks.push(Buffer.from(value.buffer, value.byteOffset, value.byteLength));
  }
  const all = Buffer.concat(chunks, total);
  return new Uint8Array(all.buffer, all.byteOffset, all.byteLength);
}

/**
 * What a link answers, when it is a picture or a pdf: { bytes, mime }. Null for anything else, and for an address that
 * cannot be read now (an error, no answer within `timeoutMs`): that is for addItem to make a row of. Only a picture or a
 * pdf larger than the library keeps throws. An answer that does not say what it is (application/octet-stream, or no type)
 * is told by its first bytes.
 */
async function download(url, { fetch: get, timeoutMs }) {
  let response;
  try {
    response = await get(url, { redirect: 'follow', headers: { accept: DOWNLOAD_ACCEPT }, signal: AbortSignal.timeout(timeoutMs) });
  } catch { return null; }
  const drop = () => { if (response.body) response.body.cancel().catch(() => {}); return null; };
  if (!response.ok || !/^https?:/i.test(response.url || url)) return drop();
  const type = mimeOf(response.headers.get('content-type'));
  const image = !!IMAGE_MIMES[type], pdf = PDF_MIMES.has(type), unsure = !type || /^(?:application|binary)\/octet-stream$/.test(type);
  if (!image && !pdf && !unsure) return drop();
  const max = image ? MAX_IMAGE_BYTES : MAX_PDF_BYTES;
  const tooLarge = image ? 'The image is larger than 20 MB' : 'The file is larger than 200 MB';
  if (Number(response.headers.get('content-length')) > max) { drop(); throw new Error(tooLarge); }
  let bytes;
  try { bytes = await readCapped(response, max, tooLarge); } catch (error) { if (error.code === 'TOO_LARGE') throw new Error(tooLarge); return null; }
  if (image || pdf) return { bytes, mime: type };
  if (isPdfBytes(bytes)) return { bytes, mime: 'application/pdf' };
  const sniffed = imageMimeOf(bytes);
  return sniffed ? { bytes, mime: sniffed } : null;
}

/**
 * A link dropped onto the library or a workspace: read here (http(s) only, within `timeoutMs`, at most 20 MB for a
 * picture and 200 MB for a pdf, told by its content type). A picture or a pdf is kept as a copy with the link
 * (addFileCopy); anything else, an ordinary page among them, is added as + Add adds it (addItem, with `describe`,
 * `identifyRepo` and `inspectPdf`). `fetch` is the app's: the Stage's session, so a page behind a sign-in answers too.
 */
async function addFromUrl(ctx, input, { fetch: get = globalThis.fetch, timeoutMs = DOWNLOAD_TIMEOUT_MS, describe, identifyRepo, inspectPdf } = {}) {
  if (typeof input !== 'string' || input.length > 8192) throw new TypeError('Drop a link from the web');
  let address;
  try { address = new URL(input.trim()); } catch { throw new TypeError('That link is not a valid address'); }
  if (address.protocol !== 'http:' && address.protocol !== 'https:') throw new TypeError('Only http(s) links can be added');
  const got = await download(address.href, { fetch: get, timeoutMs });
  if (!got) return addItem(ctx, address.href, { describe, identifyRepo, inspectPdf });
  return addFileCopy(ctx, { bytes: got.bytes, mime: got.mime, url: address.href }, { inspectPdf });
}

/* ------------------------------------------------------------ re-categorizing */

const within = (promise, ms) => new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error('timed out')), ms);
  Promise.resolve(promise).then(resolve, reject).finally(() => clearTimeout(timer));
});

/**
 * Brings every row that is behind CATEGORY_RULES up to them: a library from before the rules (its
 * types converted by db.cjs), a row made under older rules, a pdf that could not be read when it
 * was added. Each row is put through what + Add would tell about it today, from the thing itself —
 * its address, whether its folder has a `.git`, and for a pdf its content (`inspectPdf`) — and is
 * then marked, so this happens once per row per set of rules.
 *
 * It writes `type`, `tags` and `categorized`, and nothing else: no summary is cleared, made stale
 * or asked for again, and `last_edited` stays. A tag is only ever added: what showed that a row is
 * a repository may no longer be on it (a `git@host:…` spelling), and a folder or file that is not
 * there now says nothing either way. A pdf that is not there (a disk that is not mounted) or that
 * nobody here can read (no `inspectPdf`) stays due; one that is there and cannot be read, or whose
 * reader does not answer within `inspectTimeoutMs`, is settled without a tag, so that no file can
 * hold the library shut or be parsed at every launch.
 */
async function recategorize(ctx, { inspectPdf = null, inspectTimeoutMs = 15_000 } = {}) {
  const report = { changed: [], due: 0 };
  await ctx.libraryDb.settleUninferable(CATEGORY_RULES);
  for (const row of await ctx.libraryDb.uncategorized(CATEGORY_RULES)) {
    const type = typeOfRow(row);
    const tags = new Set([...row.tags, ...addressTags(row.url)]);
    if (row.github_id) tags.add('git');
    if (row.folder_path && fs.existsSync(path.join(row.folder_path, '.git'))) tags.add('git');
    let settled = true;
    if (type === 'pdf') {
      if (!inspectPdf || !fs.existsSync(row.path)) settled = false;
      else { try { for (const tag of await within(inspectPdf(row.path), inspectTimeoutMs)) tags.add(tag); } catch { /* not readable as a pdf */ } }
    }
    const next = LIBRARY_TAGS.filter((tag) => tags.has(tag));
    const differs = type !== row.type || next.length !== row.tags.length;
    if (differs || settled) await ctx.libraryDb.setCategory(row.id, { type, tags: next }, settled ? CATEGORY_RULES : null);
    if (differs) report.changed.push({ id: row.id, name: row.name, type, tags: next });
    if (!settled) report.due += 1;
  }
  return report;
}

/* ------------------------------------------------------------------ the peek */

const PEEK_CHARS = 6000;
const PEEK_FILES = 40;
const inside = (file, dir) => file === dir || file.startsWith(dir + path.sep);
// What a folder's listing leaves out: the peek's and the @ menu's (store/folder-files.cjs, MATH-22).
const PEEK_SKIP = new Set(['.git', '.DS_Store']);

/**
 * What hovering a library row shows beyond the row itself: an md's text, a data file's first lines,
 * a repository's top-level files (from the clone, else asked of GitHub through `listRemoteFiles`),
 * and the projects and workspaces that hold it.
 */
async function previewItem(ctx, id, { listRemoteFiles } = {}) {
  if (typeof id !== 'string' || !UUID_RE.test(id)) throw new TypeError('library id is invalid');
  const row = await ctx.libraryDb.get(id);
  if (!row) throw new Error('Unknown library item');
  const out = { id: row.id, text: null, lines: null, files: null, owner: null, folder: null, folderMissing: null, heldBy: await projectsForLibraryItem(ctx, row.id) };
  const home = fs.realpathSync(ctx.homeDir);
  const readable = (file) => { try { const real = fs.realpathSync(file); return inside(real, home) ? real : null; } catch { return null; } };
  if (row.type === 'md' && row.path) {
    const file = readable(row.path);
    if (file) { try { out.text = fs.readFileSync(file, 'utf8').slice(0, PEEK_CHARS); } catch { out.text = null; } }
  } else if (TEXT_TYPES.has(row.type) && row.path) {
    const file = readable(row.path);
    try {
      if (file && fs.statSync(file).size <= 2 * 1024 * 1024) out.lines = fs.readFileSync(file, 'utf8').slice(0, PEEK_CHARS).split('\n').slice(0, 12);
    } catch { out.lines = null; }
  }
  let folder = row.folder_path ? readable(row.folder_path) : null;
  if (!folder && tagged(row, 'git') && row.url) {
    // No clone on the row, or the one it had is gone: a project may be working in one. It is remembered.
    folder = findProjectClone(ctx, row.url);
    if (folder) await ctx.libraryDb.updateRepo(row.id, { name: row.name, url: row.url, folder_path: folder, github_id: row.github_id });
  }
  const tilde = (value) => (inside(value, home) ? `~${value.slice(home.length)}` : value);
  // The folder was deleted, moved, or is on a disk that is not mounted: the row stays and says so.
  if (!folder && row.folder_path) out.folderMissing = tilde(row.folder_path);
  if (folder) {
    out.folder = tilde(folder);
    try {
      out.files = fs.readdirSync(folder, { withFileTypes: true })
        .filter((entry) => !PEEK_SKIP.has(entry.name))
        .sort((a, b) => Number(b.isDirectory()) - Number(a.isDirectory()) || a.name.localeCompare(b.name))
        .slice(0, PEEK_FILES)
        .map((entry) => entry.name + (entry.isDirectory() ? '/' : ''));
    } catch { out.files = null; }
  }
  const github = tagged(row, 'git') && row.url ? row.url.match(GITHUB_RE) : null;
  if (github) {
    out.owner = github[1];
    if (!out.files && listRemoteFiles) { try { out.files = await listRemoteFiles(github[1], github[2]); } catch { out.files = null; } }
  }
  return out;
}

module.exports = { seedIfEmpty, listLibrary, readLibraryFile, readAnnotations, writeAnnotations, keepAnnotations, readPageAnnotations, annotationsFileOf, writePageAnnotations, addMarkAnswer, addWebMark, updateWebMark, readWebMark, removeWebMark, restoreWebMark, cropFile, projectsForLibraryItem, libraryForProject, bodiesForProject, bodiesForLibrary, MAX_BODY_CHARS, canonicalRemote, readCloneRemote, resolveAddition, addressTags, addItem, addPdfCopy, addPageCopy, addMarkdownCopy, isPdfBytes, writePdfCopy, MAX_PDF_BYTES, addFileCopy, addFromUrl, imageMimeOf, MAX_IMAGE_BYTES, lookupItem, recategorize, CATEGORY_RULES, previewItem, FILE_TYPES, PEEK_SKIP };
