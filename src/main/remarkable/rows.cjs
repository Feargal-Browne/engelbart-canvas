'use strict';

// The library's rows for the reMarkable documents (2026-10-31, after "you can't actually interact with the remarkable
// files"): one row per document, its PDF in the mirror (./sync.cjs), or its `.md` for an ebook, so a notebook is found
// by the library's search and the @ menu, opens in the Stage's paper viewer, joins a workspace, takes highlights and
// notes, and reaches Bart, as any paper does. Until then the mirror was one folder row, which the Stage could not open.
//
// A row is the same row for as long as its document is the same document: <root>/rows.json maps each document's id to
// its row and to the name and file the row was last given. A rename or a move on the tablet renames the row or points
// it at the new file (its ink, highlights, stars and links in Engelbart stay with it); a name changed in Engelbart is
// kept until the tablet's name changes. A document gone from the tablet (deleted, or in its trash) takes its row with
// it. A PDF row is left to be read for whether it is a paper (categorized null), as a PDF added by hand is.
// Disconnecting takes the rows away but keeps rows.json, so connecting again brings each document back as the same row
// (the same id): the ink, notes, stars, mentions and workspace links Engelbart keeps by it come back with it.
//
// A PDF sent from Engelbart (./send.cjs) and written on on the tablet has no row of its own: the row it was sent from
// is pointed at the tablet's copy (its PDF with the tablet's ink drawn in, its pages in their own order: ./sync.cjs), so
// the one item shows the tablet's ink and handwriting under the highlights and notes made in Engelbart, which stay
// with the row as they are kept by its id and page numbers. rows.json keeps the row's own file (`original`); the row
// goes back to it when the copy has no ink, goes from the tablet, or reMarkable is disconnected. Its name is the
// row's own throughout. More copies sent from one row are one item: their ink is drawn into the first's PDF
// (./sync.cjs), and they have no row. Not for a row that holds no file: such a copy gets a row of its own, as any
// document.
// `refreshed(ids)`: the rows whose file changed (another file, or the same one written again), so a Stage tab showing
// one takes it again.

const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { libraryDir } = require('./sync.cjs');

const CATEGORY_RULES = 1; // library.cjs CATEGORY_RULES: an md row needs no reading

const readJson = (file) => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; } };
function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 1)}\n`);
  fs.renameSync(temporary, file);
}
const realOr = (file) => { try { return fs.realpathSync(file); } catch { return file; } };

/** The file a document's row points at, relative to library/: its PDF, else its `.md`; null when it has neither yet. */
const fileOf = (item) => (item.files || []).find((f) => f.endsWith('.pdf')) || (item.files || []).find((f) => f.endsWith('.md')) || null;

/** Whether `file` is one of the mirror's (under `library`, as spelled or as its real path). */
const inMirror = (library, file) => {
  if (typeof file !== 'string' || !file) return false;
  const abs = path.resolve(file);
  return [library, realOr(library)].some((dir) => abs.startsWith(path.resolve(dir) + path.sep));
};

/** Row `row`'s ink, kept with it before its file changes (ink filed by its old file would no longer be found). */
async function keepInk(ctx, row) {
  if (!ctx.dataRoot) return;
  try { await require('../store/library.cjs').keepAnnotations(ctx, row.id); } catch { /* nothing kept by its file */ }
}

/** A row a sent copy's ink was on, pointed at its own file again (`original`). → the row as it is now, or null if unchanged. */
async function restoreRow(ctx, library, row, original) {
  if (!row || !original || row.path === original || !inMirror(library, row.path)) return null;
  return (await ctx.libraryDb.updatePath(row.id, original)) || { ...row, path: original };
}

/**
 * Brings the library's rows up to the mirror at `root` (mirrorDir(<dataRoot>)). `ctx`: the store's context (its
 * libraryDb). `refreshed(ids)`: told the rows whose file changed, when any did. → { added, changed, removed }, counts.
 */
async function reconcileRows(ctx, root, { refreshed = null } = {}) {
  const state = readJson(path.join(root, 'state.json'));
  // No mirror to follow (disconnected, or its state unreadable this moment): the rows are left as they are. Taking
  // them away is disconnecting's alone (removeRows).
  if (!state || state.v !== 1 || !state.connected) return { added: 0, changed: 0, removed: 0 };
  const mapFile = path.join(root, 'rows.json');
  const map = readJson(mapFile) || {};
  // Spelled from the data root as given, as the library's own copies are: what a row's path is checked against
  // (inside the home folder) is spelled that way too.
  const library = libraryDir(root);
  const real = realOr(library);
  const rows = new Map((await ctx.libraryDb.list()).map((row) => [row.id, row]));
  const out = { added: 0, changed: 0, removed: 0 };
  const next = {};

  // The one folder row an earlier build added for the whole mirror (the Stage could not open it): taken away.
  for (const row of rows.values()) {
    if (row.type === 'folder' && row.folder_path && (row.folder_path === library || row.folder_path === real)) {
      await ctx.libraryDb.remove(row.id);
      out.removed += 1;
    }
  }

  const items = state.items || {};
  // A row is one document's: the rows still mapped to documents the mirror has are theirs, and adopting a row by its
  // file never takes one of those (a rename and a new document of the old name in one sync).
  const claimed = new Set(Object.entries(map).filter(([docId, was]) => was && items[docId] && rows.has(was.row)).map(([, was]) => was.row));
  const holders = new Map(); // a row → the sent copy whose ink is on it (one each)
  for (const [docId, was] of Object.entries(map)) if (was && was.original && items[docId] && !items[docId].joined && !holders.has(was.row)) holders.set(was.row, docId);
  const originals = new Map(); // a row → its own file, as a sent copy's record kept it
  for (const was of Object.values(map)) if (was && was.original && !originals.has(was.row)) originals.set(was.row, was.original);
  const files = new Set(); // rows whose file changed
  const fresh = (was, item) => was && was.version !== undefined && was.version !== item.version;
  for (const [docId, item] of Object.entries(items)) {
    if (item.kind !== 'document' || item.joined) continue; // a later copy of a row's: in the first's PDF
    const rel = fileOf(item);
    let was = map[docId];
    // A copy sent from Engelbart: onto the row it was sent from.
    if (item.sent && typeof item.from === 'string') {
      const origin = rows.get(item.from);
      const original = origin && (inMirror(library, origin.path) ? (was && was.original) || originals.get(origin.id) || null : origin.path);
      const already = !!(was && was.original && was.row === item.from); // its ink is on that row already
      const free = origin && (holders.get(origin.id) || docId) === docId && (already || !claimed.has(origin.id));
      if (origin && origin.type === 'pdf' && original && free) {
        holders.set(origin.id, docId);
        claimed.add(origin.id);
        const file = rel && rel.endsWith('.pdf') ? path.join(library, rel) : original; // no ink (yet, or any more): its own
        if (origin.path !== file) {
          if (file !== original) await keepInk(ctx, origin);
          rows.set(origin.id, (await ctx.libraryDb.updatePath(origin.id, file)) || { ...origin, path: file });
          out.changed += 1;
          files.add(origin.id);
        } else if (file !== original && fresh(was, item)) files.add(origin.id);
        next[docId] = { row: origin.id, name: origin.name, file: file === original ? null : file, original, version: item.version };
        continue;
      }
      // The row is gone (removed in Engelbart), holds no file, or has another copy's ink: a row of its own.
      if (was && was.original) {
        const back = origin && (holders.get(origin.id) || docId) === docId ? await restoreRow(ctx, library, origin, was.original) : null;
        if (back) { rows.set(back.id, back); out.changed += 1; files.add(back.id); }
        was = undefined;
      }
    }
    if (!rel) continue;
    const file = path.join(library, rel);
    const type = rel.endsWith('.pdf') ? 'pdf' : 'md';
    const name = String(item.name || item.base || 'Untitled').slice(0, 512);
    let row = was && rows.get(was.row);
    if (!row && was && was.row && !rows.has(was.row)) {
      // Taken away on disconnecting, connected again: the same row (its id), so what Engelbart keeps by it comes back.
      row = await ctx.libraryDb.insert({ id: was.row, name: was.name || name, type, tags: [], path: file, url: null, folder_path: null, project_id: null, github_id: null, categorized: type === 'pdf' ? null : CATEGORY_RULES });
      rows.set(row.id, row);
      claimed.add(row.id);
      out.added += 1;
    }
    if (!row && !was) { // a row for this file already, nobody else's (adopted)
      row = [...rows.values()].find((r) => r.path === file && !claimed.has(r.id)) || null;
      if (row) claimed.add(row.id);
    }
    if (!row) {
      row = await ctx.libraryDb.insert({ id: randomUUID(), name, type, tags: [], path: file, url: null, folder_path: null, project_id: null, github_id: null, categorized: type === 'pdf' ? null : CATEGORY_RULES });
      rows.set(row.id, row);
      claimed.add(row.id);
      out.added += 1;
    } else {
      if ((!was || was.name !== name) && row.name !== name) { row = (await ctx.libraryDb.rename(row.id, name)) || { ...row, name }; out.changed += 1; }
      if (row.path !== file) { row = (await ctx.libraryDb.updatePath(row.id, file)) || { ...row, path: file }; out.changed += 1; files.add(row.id); }
      else if (fresh(was, item)) files.add(row.id);
      rows.set(row.id, row);
    }
    next[docId] = { row: row.id, name, file, version: item.version };
  }
  // Documents gone from the tablet: their rows go too; a row a sent copy's ink was on stays, with its own file again.
  for (const [docId, was] of Object.entries(map)) {
    if (next[docId] || !was || !rows.has(was.row)) continue;
    if (was.original) {
      if (!holders.has(was.row) && await restoreRow(ctx, library, rows.get(was.row), was.original)) { out.changed += 1; files.add(was.row); }
      continue;
    }
    await ctx.libraryDb.remove(was.row);
    out.removed += 1;
  }
  writeJson(mapFile, next);
  if (files.size && typeof refreshed === 'function') { try { refreshed([...files]); } catch { /* a listener never breaks a sync */ } }
  return out;
}

/**
 * Takes every reMarkable row out of the library (disconnecting); a row a sent copy's ink was on stays, with its own file
 * again. → how many rows were taken away or changed.
 */
async function removeRows(ctx, root) {
  const map = readJson(path.join(root, 'rows.json')) || {};
  const library = libraryDir(root);
  const merged = new Set(Object.values(map).filter((was) => was && was.original).map((was) => was.row));
  const rows = merged.size ? new Map((await ctx.libraryDb.list()).map((row) => [row.id, row])) : new Map();
  let removed = 0;
  for (const was of Object.values(map)) {
    if (!was || !was.row) continue;
    if (was.original) {
      if (await restoreRow(ctx, library, rows.get(was.row), was.original)) removed += 1;
    } else if (!merged.has(was.row) && await ctx.libraryDb.remove(was.row)) removed += 1;
  }
  return removed;
}

/**
 * What library row `rowId` is to reMarkable (rows.json at `root`): 'tablet', a document of the tablet's; 'merged', a row
 * a sent copy's ink comes onto; null, neither.
 */
function rowKind(root, rowId) {
  const map = readJson(path.join(root, 'rows.json')) || {};
  let kind = null;
  for (const was of Object.values(map)) {
    if (!was || was.row !== rowId) continue;
    if (!was.original) return 'tablet';
    kind = 'merged';
  }
  return kind;
}

module.exports = { reconcileRows, removeRows, rowKind };
