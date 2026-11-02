import React from 'react';
import { EDGE as WINDOW_EDGE } from '../ui/WindowEdges.jsx';
import { isGithubSignIn } from '../../shared/github.cjs';
import { isPreviewAddress } from '../../shared/address-key.cjs';
import { createPortal } from 'react-dom';
import { api, errorMessage } from '../api.js';
import { usePreviewTouch, useSandboxes } from '../ui/SandboxProgress.jsx';
import { previewLibraryId } from '../model/sandbox-notifications.js';
import { KindGlyph, SEARCH, FOLDER, Expand, Collapse } from '../ui/Icons.jsx';
import { kindOf, stripScheme, OPEN_IN_BROWSER } from '../model/address.js';
import { MAX_TABS, SAVE_LABEL, WAKE_RETRY_MS, addressKey, afterClose, landTab, landingFinds, linkPlan, looksLikePlace, onStage, placeTab, previewName, previewWait, restoreTabs, stageRows, stageSnapshot, tabKey, tabPlace, parseTable, withPassage } from '../model/stage.js';
import { markdownBlocks, inlineRuns } from '../model/markdown.js';
import PaperView from '../pdf/PaperView.jsx';
import { withAsk } from '../pdf/canvas.js';
import ImportSignins from './ImportSignins.jsx';
import SendToRemarkable from './SendToRemarkable.jsx';

const IS_MAC = typeof navigator !== 'undefined' && /Mac/i.test(navigator.platform || '');

// A pdf that is a document of the tablet's (src/main/remarkable/rows.cjs rowKind 'tablet'; one not in the library, by its
// file in the reMarkable mirror): Send to reMarkable is not offered for it. A row the tablet's ink came back onto
// ('merged') can be sent again, to take the highlights made since.
const IN_REMARKABLE = /\/\.remarkable\/library\//;
const fromRemarkable = (pdf, kinds) => (pdf.rowId ? kinds[pdf.rowId] === 'tablet' : IN_REMARKABLE.test(String(pdf.input || '')));

// The Stage (Claude Design "Add - Mention Stage.dc.html", 2026-09-23): the Browser and the Paper pane made one. A tab
// shows whatever it was given — a library row, a link, a file on disk — in the way its format asks:
//  · a page (the web, a local server, an html file) is a WebContentsView in the main process (src/main/browser/
//    views.cjs), laid over the placeholder here, so no site can refuse it as a frame; while a menu or a card reaches
//    over the placeholder the view is hidden behind a picture of itself (anything floating needs data-overlay="1");
//  · a pdf — from the web (main turns it into bytes: browser:pdf), from disk or from the library — is drawn by
//    PaperView, with its ink: a row's own, else kept by its address;
//  · a docx (macOS textutil) is a page made from it; markdown is drawn as text, a csv or tsv as a table, a picture
//    (heic through sips) as itself, other text as it is (main: stage-file).
// Tabs: at most 15; what is opened comes forward if it is open already, takes a blank tab in front, else gets its own
// (at 15 it takes the place of the tab in front). They are kept per project across ⌘R and quitting (MATH-10, main's
// state.json `stages`): each comes back with its title, unshown, and opens the first time it comes forward. ⌘T and ⌘W
// work from anywhere but the terminal and bring the Stage forward; ⌘F finds in whatever is in front. The address field opens anything: a link or a path goes there, words list
// this workspace, then the library (never notes: they open in the middle), then a web search. Its right end is the
// thing's place in the library (+ Save / + Workspace / ✓, Add - Mention.dc.html); a web pdf is saved as a copy.
// A link may name a passage (2026-09-30, @discover's guide: `address#find=words`, model/stage.js splitTarget): its tab
// keeps it as `pendingFind` until what it shows is ready — a pdf drawn (PaperView `target`), a page loaded, a file drawn
// here — then finds it once: the match in front is scrolled to, and in a pdf the find card opens with the words (a page
// or a file shows the highlight alone, 2026-10-03, unless the card is open already: it takes the words). `&to=` (round 2)
// is kept as `pendingTo` beside it, for a pdf only: PaperView tints the section it ends; a page or a file ignores it.
// A link in an @discover guide (2026-10-03) brings the guide's other sections for the same paper (DocEditor, model/stage.js
// guideSections), kept on the tab as `sections` with the clicked one `activeSection`. In a pdf it opens no find card: the
// section is scrolled to and tinted, and a Sections menu where the find card sits shows another, or clears it (×).
// A pdf's margin notes mention library items (MATH-21): `@` in a note opens the workspace's @ menu (`mentionItems`, its
// library rows only), and a mention clicked in a note opens its row as the sidebar does (`onOpenItem`).
// @bart on a highlight (MATH-27): a note on a pdf's highlight that starts with @bart asks through `onAsk`, given which pdf
// it is (its library row, else its address) and its name; what the answer is doing comes back as `pendingAsks` (the
// workspace's, each with its rowId or url), of which the viewer is given its own pdf's. The finished answer (`onAsk`'s
// result) goes onto its mark: through the viewer when it shows that pdf (it saves it as any edit), and into every tab
// that holds the pdf (landAnswer); main has put it in the kept ink already. Stop, close, Copy and Continue in workspace
// go up as they are.
// Second pass (2026-10-06): every tab holding a pdf takes its ink whenever the viewer saves it, so one brought forward
// later never saves what it read before over it; and main tells every window how a question from a highlight ended
// (onPaperAskDone), so its answer lands here too in a window reloaded since it asked, or another holding the pdf.
// Boxes on a page (MATH-70 build 1): the Box button lays main's drawing layer over the page (⌥ held in the page does the
// same, main: browser/views.cjs); a box removed in the page (Backspace) shows "Box removed · Undo" in the address row,
// beside the page and never over it, for about REMOVED_MS.
// A box's card (MATH-70 build 2, main's own view beside the selected box: browser/views.cjs): @bart asked from it comes
// here (onBrowserBoxAsk) and is asked through `onAsk` as from a highlight, its mark a web page's ({ source: 'web', url });
// Stop on it stops the run (onStopAsk), or closes a failed one (onDismissAsk). What is running from boxes goes back to
// main (browserBoxAsks) for the card to show; main has put each finished answer on the mark itself.

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const EASE = 'cubic-bezier(.25,.1,.25,1)';
const DEVICES = [
  { id: 'fit', name: 'Fit panel', w: 0, h: 0 },
  { id: 'se', name: 'iPhone SE', w: 375, h: 667 },
  { id: '12', name: 'iPhone 12 Pro', w: 390, h: 844 },
  { id: '15', name: 'iPhone 15 Pro Max', w: 430, h: 932 },
  { id: 'px8', name: 'Pixel 8', w: 412, h: 915 },
  { id: 'ipad', name: 'iPad mini', w: 768, h: 1024 },
];
const ERR_CONNECTION_REFUSED = -102;
const RETRY_MS = 2000;
const STAGE_SAVE_MS = 150; // the tabs are kept this long after they last changed (and at once when the page goes away)
const REMOVED_MS = 5000; // how long "Box removed · Undo" stays (as a pdf's "Highlight removed")
const HOVER_MS = 650; // a tab's card, the first time; then quickly while moving along the strip
const newId = () => (window.crypto && window.crypto.randomUUID ? window.crypto.randomUUID() : String(Date.now() + Math.random()));
const blankTab = () => ({ id: newId(), url: 'about:blank', web: null, item: null, file: null, pdf: null, pendingFind: null, pendingTo: null, sections: null, activeSection: -1 });
const noSections = (t) => (t.sections && t.sections.length ? { ...t, sections: null, activeSection: -1 } : t);
const isPage = (k) => k.kind === 'web' || k.kind === 'local' || k.kind === 'disk';
const hasScheme = (input) => /^https?:\/\//i.test(input);
const quiet = (promise) => promise.catch(() => {});
const DISK_URL = /^file:/i;
const WEB_URL = /^https?:/i;
const fileUrl = (file) => `file://${String(file).split('/').map(encodeURIComponent).join('/')}`;
const editable = (el) => !!(el && el.closest && el.closest('input, textarea, [contenteditable="true"], [data-terminal]'));
const inTerminal = (el) => !!(el && el.closest && el.closest('[data-terminal]'));
const basename = (value) => String(value || '').split('/').pop();
const VIEWS = new Set(['md', 'table', 'text', 'image', 'folder', 'unsupported', 'error', 'loading']); // a file drawn here, not in the view

const ICON_BUTTON = { width: 26, height: 26, padding: 0, border: 0, borderRadius: 6, background: 'transparent', cursor: 'pointer', font: '14px/1 var(--font-sans)' };
// The pdf's "Highlight removed · Undo" (PaperView TOAST), standing in the address row.
const BOX_TOAST = { flex: 'none', display: 'flex', alignItems: 'center', gap: 4, height: 26, boxSizing: 'border-box', padding: '0 4px 0 10px', background: '#171717', borderRadius: 8, font: '400 12.5px/1 var(--font-sans)', color: '#fff', whiteSpace: 'nowrap' };
const BOX_TOAST_UNDO = { flex: 'none', height: 20, padding: '0 8px', border: 0, borderRadius: 5, background: 'transparent', font: '500 12.5px/1 var(--font-sans)', color: '#fff', cursor: 'pointer' };

// A file, for its glyph: what the library would call it. A tab given back and not shown yet (`restore`): what it will
// show, its library row found by `rowOf`.
const IMAGE_EXT = /\.(png|jpe?g|gif|webp|heic|heif|svg)$/i;
function glyphItem(tab, rowOf) {
  if (!tab) return { type: 'website' };
  if (tab.restore) {
    const { item, address } = tab.restore;
    if (item) return (rowOf && rowOf(item)) || { type: 'website' };
    if (/\.pdf$/i.test(address)) return { type: 'pdf' };
    return glyphItem(address.startsWith('/') ? { url: 'about:blank', file: { path: address } } : { url: address });
  }
  if (tab.row) return tab.row;
  if (tab.pdf) return { type: 'pdf' };
  const where = tab.file && tab.file.path ? tab.file.path : '';
  if (where) {
    if (IMAGE_EXT.test(where)) return { type: 'image' };
    const ext = (where.match(/\.([a-z0-9]+)$/i) || [])[1] || '';
    if (/^(md|markdown)$/i.test(ext)) return { type: 'md' };
    if (/^docx?$/i.test(ext)) return { type: 'docx' };
    if (/^(csv|tsv|json|jsonl)$/i.test(ext)) return { type: 'csv' };
    if (/^html?$/i.test(ext)) return { type: 'html' };
    if (tab.file.kind === 'folder') return { type: 'folder' };
    return { type: 'md' };
  }
  return kindOf(tab.url).kind === 'disk' ? { type: 'html' } : { type: 'website' };
}

/* ------------------------------------------------------------------------------------------------- small views */

// Three books on a shelf, one of them banded (Hudson's reference, Add - Mention.dc.html).
const Shelf = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" style={{ display: 'block', flex: 'none', fill: 'currentColor', stroke: 'none' }}>
    <rect x="1.5" y="3" width="3.2" height="11" rx="1" />
    <path fillRule="evenodd" d="M6 5a1 1 0 0 1 1-1h1.4a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1zM6.85 6.4a.5.5 0 0 1 .5-.5h.7a.5.5 0 0 1 0 1h-.7a.5.5 0 0 1-.5-.5zm0 5.2a.5.5 0 0 1 .5-.5h.7a.5.5 0 0 1 0 1h-.7a.5.5 0 0 1-.5-.5z" />
    <rect x="10.8" y="2" width="3.2" height="12" rx="1" />
  </svg>
);
// A dashed square with a pointer in its corner: the Box tool (MATH-70). Lucide's square-dashed-mouse-pointer, the icon of
// engelbart-web's Annotate control (components/annotate/control.tsx), which David liked (2026-10-07).
const BoxGlyph = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" aria-hidden="true" style={{ display: 'block', flex: 'none', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' }}>
    <path d="M12.034 12.681a.498.498 0 0 1 .647-.647l9 3.5a.5.5 0 0 1-.033.943l-3.444 1.068a1 1 0 0 0-.66.66l-1.067 3.443a.5.5 0 0 1-.943.033z M5 3a2 2 0 0 0-2 2 M19 3a2 2 0 0 1 2 2 M5 21a2 2 0 0 1-2-2 M9 3h1 M9 21h2 M14 3h1 M3 9v1 M21 9v2 M3 14v1" />
  </svg>
);
const Grid = () => (
  <svg width="15" height="15" viewBox="0 0 16 16" aria-hidden="true" style={{ display: 'block', flex: 'none', fill: 'none', stroke: 'currentColor', strokeWidth: 1.5, strokeLinejoin: 'round', strokeLinecap: 'round' }}>
    <path d="M2.5 1.5h2.5a1 1 0 0 1 1 1v2.5a1 1 0 0 1-1 1h-2.5a1 1 0 0 1-1-1v-2.5a1 1 0 0 1 1-1z M9 1.5h4.5a1 1 0 0 1 1 1v2.5a1 1 0 0 1-1 1h-4.5a1 1 0 0 1-1-1v-2.5a1 1 0 0 1 1-1z M2.5 8h4.5a1 1 0 0 1 1 1v4.5a1 1 0 0 1-1 1h-4.5a1 1 0 0 1-1-1v-4.5a1 1 0 0 1 1-1z M11 8h2.5a1 1 0 0 1 1 1v2.5a1 1 0 0 1-1 1h-2.5a1 1 0 0 1-1-1v-2.5a1 1 0 0 1 1-1z" />
  </svg>
);

function SaveTip({ text }) {
  return <div role="tooltip" style={{ position: 'absolute', right: 0, top: 'calc(100% + 6px)', zIndex: 50, padding: '6px 9px', border: '1px solid #eaeaea', borderRadius: 6, background: '#fff', color: '#4d4d4d', font: '400 11.5px/1.3 var(--font-sans)', whiteSpace: 'nowrap', pointerEvents: 'none', animation: `rise 120ms ${EASE}` }}>{text}</div>;
}

// "+ Save": the thing's name in the library, then where it goes — the library alone, or the library and this workspace
// (the heavier button, and what Enter does).
function SaveCard({ title, onSave, onClose, cardRef }) {
  const [name, setName] = React.useState(title);
  const [tip, setTip] = React.useState(null);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState('');
  const commit = async (here) => {
    if (busy) return;
    setBusy(true);
    setError('');
    try { await onSave(name.trim() || title, here); onClose(); } catch (failure) { setError(errorMessage(failure)); } finally { setBusy(false); }
  };
  const button = { display: 'flex', alignItems: 'center', gap: 7, height: 28, padding: '0 9px 0 7px', borderRadius: 6, cursor: 'pointer', font: '500 12.5px/1 var(--font-sans)' };
  return (
    <div ref={cardRef} data-overlay="1" data-save-card="1" style={{ position: 'absolute', right: 10, top: 44, zIndex: 40, width: 360, maxWidth: 'calc(100% - 20px)', boxSizing: 'border-box', padding: '14px 16px 14px', background: '#fff', border: '1px solid #c9c9c9', borderRadius: 8, boxShadow: '0 12px 32px rgba(0,0,0,.06)', textAlign: 'left', animation: `rise 160ms ${EASE}` }}>
      <input
        ref={(element) => { if (element && !element.dataset.focused) { element.dataset.focused = '1'; element.focus({ preventScroll: true }); element.select(); } }}
        value={name}
        readOnly={busy}
        onChange={(event) => { setName(event.target.value); setError(''); }}
        onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); void commit(true); } else if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onClose(); } }}
        aria-label="Name in the library"
        spellCheck={false}
        className="save-name"
        style={{ display: 'block', width: '100%', boxSizing: 'border-box', marginTop: 9, padding: '0 0 4px', border: 0, borderBottom: '1px solid #eaeaea', background: 'transparent', font: '500 14.5px/1.4 var(--font-sans)', color: '#171717', transition: 'border-color 120ms' }}
      />
      {error && <div style={{ paddingTop: 6, font: '12px/1.5 var(--font-sans)', color: '#e70022', overflowWrap: 'anywhere' }}>{error}</div>}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 6, marginTop: 14 }}>
        <div style={{ position: 'relative', display: 'flex' }}>
          <button type="button" className="hov-outline" disabled={busy} onClick={() => commit(false)} onMouseEnter={() => setTip('lib')} onMouseLeave={() => setTip(null)} aria-label="Add to library only" style={{ ...button, border: '1px solid transparent', background: 'transparent', color: '#4d4d4d', transition: 'color 120ms, border-color 120ms' }}>
            <Shelf /><span>Library only</span>
          </button>
          {tip === 'lib' && <SaveTip text="Add to library only" />}
        </div>
        <div style={{ position: 'relative', display: 'flex' }}>
          <button type="button" className="hov-save" disabled={busy} onClick={() => commit(true)} onMouseEnter={() => setTip('ws')} onMouseLeave={() => setTip(null)} aria-label="Add to library and this workspace" style={{ ...button, border: '1px solid #eaeaea', background: '#f2f2f2', color: '#171717', transition: 'border-color 120ms, background 120ms' }}>
            <Grid /><span style={{ fontWeight: 600 }}>Workspace</span>
          </button>
          {tip === 'ws' && <SaveTip text="Add to library and this workspace" />}
        </div>
      </div>
    </div>
  );
}

// ⌘F: a card at the top right of what is in front (the design's "Find on stage"): the query, where the match in front is
// among all of them, previous, next, close. Enter and ⇧Enter step; Escape closes.
function FindCard({ inputRef, text, found, onText, onStep, onClose }) {
  const small = { width: 24, height: 24, padding: 0, border: 0, borderRadius: 6, background: 'transparent', cursor: 'pointer', font: '13px/1 var(--font-sans)', color: '#4d4d4d' };
  const none = text && found && !found.matches;
  return (
    <div data-find-bar="1" data-overlay="1" style={{ position: 'absolute', top: 10, right: 14, left: 14, maxWidth: 360, marginLeft: 'auto', zIndex: 30, display: 'flex', alignItems: 'center', gap: 4, height: 34, boxSizing: 'border-box', padding: '0 4px 0 12px', background: '#fff', border: '1px solid #c9c9c9', borderRadius: 8, animation: `rise 160ms ${EASE}` }}>
      <input
        ref={inputRef}
        value={text}
        onChange={(event) => onText(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') { event.preventDefault(); onStep(event.shiftKey ? -1 : 1); }
          else if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onClose(); }
        }}
        aria-label="Find on this page"
        spellCheck={false}
        style={{ flex: 1, width: 'auto', minWidth: 60, padding: 0, border: 0, background: 'transparent', font: '13px/1.4 var(--font-sans)', color: '#171717' }}
      />
      <span data-find-count="1" style={{ flex: 'none', textAlign: 'right', font: '11px/1 var(--font-mono)', color: none ? '#e70022' : '#8f8f8f' }}>{text && found ? (found.matches ? `${found.active} of ${found.matches}` : '0 matches') : ''}</span>
      <span style={{ flex: 'none', width: 1, height: 16, margin: '0 4px', background: '#eaeaea' }} />
      <button type="button" className="hov-ink-wash" onClick={() => onStep(-1)} aria-label="Previous match" title="⇧⏎" style={small}>↑</button>
      <button type="button" className="hov-ink-wash" onClick={() => onStep(1)} aria-label="Next match" title="⏎" style={small}>↓</button>
      <button type="button" className="hov-ink-wash" onClick={onClose} aria-label="Close find" title="esc" style={{ ...small, color: '#8f8f8f' }}>×</button>
    </div>
  );
}

// The sections an @discover guide suggested for the paper in front (2026-10-03), where the find card sits, and under it
// while it is open: the one shown, a list of them all to show another, and × to clear the tint and the menu.
function SectionsMenu({ sections, active, below, onPick, onClose }) {
  const [open, setOpen] = React.useState(false);
  const boxRef = React.useRef(null);
  React.useEffect(() => {
    if (!open) return undefined;
    const away = (event) => { if (boxRef.current && !boxRef.current.contains(event.target)) setOpen(false); };
    document.addEventListener('mousedown', away, true);
    return () => document.removeEventListener('mousedown', away, true);
  }, [open]);
  const current = sections[active];
  const small = { flex: 'none', width: 24, height: 24, padding: 0, border: 0, borderRadius: 6, background: 'transparent', cursor: 'pointer', font: '13px/1 var(--font-sans)', color: '#8f8f8f' };
  return (
    <div ref={boxRef} data-overlay="1" data-sections-menu="1" onKeyDown={(event) => { if (event.key === 'Escape' && open) { event.preventDefault(); event.stopPropagation(); setOpen(false); } }} style={{ position: 'absolute', top: below ? 52 : 10, right: 14, zIndex: 30, width: 'max-content', maxWidth: 'min(360px, calc(100% - 28px))' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 2, height: 34, boxSizing: 'border-box', padding: '0 4px', background: '#fff', border: '1px solid #c9c9c9', borderRadius: 8, animation: `rise 160ms ${EASE}` }}>
        <button type="button" className="hov-wash" data-sections-button="1" aria-haspopup="listbox" aria-expanded={open} title="The sections the guide suggested" onClick={() => setOpen((o) => !o)} style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: 8, height: 26, padding: '0 6px 0 8px', border: 0, borderRadius: 6, background: open ? '#f2f2f2' : 'transparent', cursor: 'pointer', textAlign: 'left' }}>
          <span style={{ flex: 'none', font: '500 9px/1 var(--font-sans)', letterSpacing: '1.6px', textTransform: 'uppercase', color: '#8f8f8f' }}>Sections</span>
          <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', font: '13px/1.4 var(--font-sans)', color: '#171717' }}>{current ? current.label : ''}</span>
          <span aria-hidden="true" style={{ flex: 'none', font: '10px/1 var(--font-sans)', color: '#8f8f8f' }}>▾</span>
        </button>
        <span style={{ flex: 'none', width: 1, height: 16, margin: '0 2px', background: '#eaeaea' }} />
        <button type="button" className="hov-ink-wash" data-sections-close="1" onClick={onClose} aria-label="Clear the section" title="Clear the section" style={small}>×</button>
      </div>
      {open && (
        <div role="listbox" aria-label="Sections" style={{ marginTop: 6, maxHeight: 320, overflowY: 'auto', boxSizing: 'border-box', padding: 4, background: '#fff', border: '1px solid #eaeaea', borderRadius: 8, boxShadow: '0 12px 32px rgba(0,0,0,.06)', animation: `rise 160ms ${EASE}` }}>
          {sections.map((section, i) => (
            <div key={`${i}:${section.find}`} role="option" aria-selected={i === active} data-section-row={i} className="hov-wash" onClick={() => { setOpen(false); onPick(i); }} style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '7px 10px', borderRadius: 6, cursor: 'pointer' }}>
              <span style={{ flex: 'none', width: 14, textAlign: 'center', font: '12px/1.4 var(--font-sans)', color: '#171717' }}>{i === active ? '✓' : ''}</span>
              <span style={{ flex: 1, minWidth: 0, font: '13px/1.4 var(--font-sans)', color: '#171717', overflowWrap: 'anywhere' }}>{section.label}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// HTTP authentication (a staging site, a proxy). In the document, not in the pane: a popup can ask too.
function LoginPrompt({ request, onAnswer }) {
  const [username, setUsername] = React.useState('');
  const [password, setPassword] = React.useState('');
  const field = { padding: '8px 10px', border: '1px solid #eaeaea', borderRadius: 8, background: '#fafafa', font: '13px/1.4 var(--font-sans)', color: '#171717' };
  return (
    <div data-overlay="1" role="dialog" aria-modal="true" aria-label={`Sign in to ${request.host}`} onKeyDown={(event) => { if (event.key === 'Escape') onAnswer(null); }} style={{ position: 'fixed', inset: 0, zIndex: 130, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', paddingTop: '18vh', background: 'rgba(255,255,255,.35)' }}>
      <form onSubmit={(event) => { event.preventDefault(); onAnswer({ username, password }); }} style={{ width: 'min(360px, calc(100vw - 32px))', display: 'flex', flexDirection: 'column', gap: 10, padding: 18, background: '#fff', border: '1px solid #c9c9c9', borderRadius: 12, boxShadow: '0 12px 40px #0000001f', animation: `rise 160ms ${EASE}` }}>
        <span style={{ font: '500 14px/1.4 var(--font-sans)', color: '#171717', overflowWrap: 'anywhere' }}>{request.host}</span>
        {request.realm && <span style={{ marginTop: -6, font: '12px/1.5 var(--font-mono)', color: '#8f8f8f', overflowWrap: 'anywhere' }}>{request.realm}</span>}
        <input autoFocus value={username} onChange={(event) => setUsername(event.target.value)} aria-label="Username" autoComplete="off" spellCheck={false} style={field} />
        <input type="password" value={password} onChange={(event) => setPassword(event.target.value)} aria-label="Password" autoComplete="off" style={field} />
        <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 14, marginTop: 4 }}>
          <button type="button" className="hov-ink" onClick={() => onAnswer(null)} style={{ padding: 0, border: 0, background: 'transparent', cursor: 'pointer', font: '13px/1 var(--font-sans)', color: '#8f8f8f' }}>Cancel</button>
          <button type="submit" style={{ padding: '9px 14px', border: 0, borderRadius: 8, background: '#0070f3', color: '#fff', cursor: 'pointer', font: '500 13px/1 var(--font-sans)' }}>Sign in</button>
        </div>
      </form>
    </div>
  );
}

// A markdown file, drawn from its blocks: nothing in it is read as html.
function Runs({ text }) {
  return inlineRuns(text).map((run, i) => {
    if (run.code) return <code key={i} style={{ padding: '1px 4px', borderRadius: 4, background: '#f2f2f2', font: '0.88em/1 var(--font-mono)' }}>{run.text}</code>;
    if (run.href) return <a key={i} href={run.href} data-stage-link={run.href}>{run.text}</a>;
    if (run.bold) return <b key={i} style={{ fontWeight: 600 }}>{run.text}</b>;
    if (run.italic) return <i key={i}>{run.text}</i>;
    return <React.Fragment key={i}>{run.text}</React.Fragment>;
  });
}
const H_SIZE = { 1: 22, 2: 18, 3: 16, 4: 14.5, 5: 14.5, 6: 14.5 };
function MarkdownView({ text }) {
  const blocks = React.useMemo(() => markdownBlocks(text), [text]);
  return (
    <div style={{ boxSizing: 'border-box', padding: 24 }}>
      <div style={{ maxWidth: '65ch', margin: '0 auto', font: '400 14.5px/1.7 var(--font-sans)', color: '#171717' }}>
        {blocks.map((b, i) => {
          if (b.type === 'h') return <div key={i} style={{ margin: `${i ? 22 : 0}px 0 0`, font: `${b.level <= 2 ? 500 : 600} ${H_SIZE[b.level]}px/1.35 var(--font-sans)`, letterSpacing: b.level === 1 ? '-0.2px' : 0, textWrap: 'pretty' }}><Runs text={b.text} /></div>;
          if (b.type === 'p') return <p key={i} style={{ margin: '10px 0 0', textWrap: 'pretty' }}><Runs text={b.text} /></p>;
          if (b.type === 'li') {
            return (
              <div key={i} style={{ display: 'flex', gap: 10, margin: '4px 0 0', paddingLeft: b.depth * 22 }}>
                <span style={{ flex: 'none', minWidth: 12, color: '#8f8f8f', fontVariantNumeric: 'tabular-nums' }}>{b.checked != null ? (b.checked ? '☑' : '☐') : b.ordered ? b.marker : '•'}</span>
                <span style={{ minWidth: 0, textWrap: 'pretty', color: b.checked ? '#8f8f8f' : undefined }}><Runs text={b.text} /></span>
              </div>
            );
          }
          if (b.type === 'quote') return <div key={i} style={{ margin: '12px 0 0', padding: '2px 0 2px 14px', borderLeft: '3px solid #eaeaea', color: '#4d4d4d', textWrap: 'pretty' }}><Runs text={b.text} /></div>;
          if (b.type === 'code') return <pre key={i} style={{ margin: '12px 0 0', padding: '12px 14px', border: '1px solid #eaeaea', borderRadius: 8, background: '#fafafa', overflowX: 'auto', font: '12.5px/1.6 var(--font-mono)', color: '#171717' }}>{b.text}</pre>;
          return <hr key={i} style={{ margin: '18px 0 0', border: 0, borderTop: '1px solid #eaeaea' }} />;
        })}
      </div>
    </div>
  );
}

const TABLE_ROWS = 2000;
function TableView({ text, delimiter, truncated }) {
  const rows = React.useMemo(() => parseTable(text, delimiter, TABLE_ROWS + 1), [text, delimiter]);
  const width = rows.reduce((most, row) => Math.max(most, row.length), 0);
  const shown = rows.slice(0, TABLE_ROWS);
  const cell = { flex: 'none', width: 200, boxSizing: 'border-box', padding: '8px 12px', borderRight: '1px solid #eaeaea', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', font: '12px/1.5 var(--font-mono)', color: '#171717' };
  return (
    <div style={{ boxSizing: 'border-box', padding: 16 }}>
      <div style={{ background: '#fff', border: '1px solid #eaeaea', borderRadius: 8, overflow: 'auto' }}>
        {shown.map((row, i) => (
          <div key={i} style={{ display: 'flex', minWidth: 'max-content', borderBottom: i === shown.length - 1 ? 0 : '1px solid #eaeaea', background: i === 0 ? '#fafafa' : '#fff' }}>
            <div style={{ flex: 'none', width: 48, boxSizing: 'border-box', padding: '8px 10px', borderRight: '1px solid #eaeaea', textAlign: 'right', font: '11px/1.5 var(--font-mono)', color: '#8f8f8f' }}>{i === 0 ? '' : i}</div>
            {Array.from({ length: width }, (_, j) => <div key={j} title={row[j] || ''} style={{ ...cell, fontWeight: i === 0 ? 500 : 400 }}>{row[j] || ''}</div>)}
          </div>
        ))}
      </div>
      <div style={{ marginTop: 10, font: '11.5px/1.5 var(--font-sans)', color: '#8f8f8f' }}>{`${Math.max(0, shown.length - 1)}${rows.length > TABLE_ROWS || truncated ? '+' : ''} rows · ${width} columns`}</div>
    </div>
  );
}

function ImageView({ file }) {
  const [src, setSrc] = React.useState(null);
  React.useEffect(() => {
    const url = URL.createObjectURL(new Blob([file.bytes], { type: file.mime || 'application/octet-stream' }));
    setSrc(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);
  return (
    <div style={{ minHeight: '100%', boxSizing: 'border-box', padding: 24, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      {src && <img src={src} alt={file.name} draggable={false} style={{ display: 'block', maxWidth: '100%', maxHeight: 'calc(100vh - 200px)', objectFit: 'contain', background: '#fff' }} />}
    </div>
  );
}

// What cannot be drawn here (a folder, a format the Stage does not read, a path with nothing at it): its name and where it is.
// `prose`: the detail is a sentence, not a path or an error code. `children`: what can be done about it (buttons).
function Plain({ title, detail, error, prose, children }) {
  return (
    <div style={{ minHeight: '100%', boxSizing: 'border-box', padding: 24, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 8, textAlign: 'center' }}>
      <span style={{ font: '500 14px/1.4 var(--font-sans)', color: '#171717', overflowWrap: 'anywhere' }}>{title}</span>
      {detail && <span style={{ maxWidth: prose ? 320 : undefined, font: prose ? '12.5px/1.5 var(--font-sans)' : '12px/1.6 var(--font-mono)', color: error ? '#e70022' : '#8f8f8f', overflowWrap: 'anywhere' }}>{detail}</span>}
      {children && <div style={{ marginTop: 10, display: 'flex', alignItems: 'center', gap: 8 }}>{children}</div>}
    </div>
  );
}

// A button under a Plain message: Retry, Build details.
function PlainAction({ onClick, primary, children }) {
  return <button type="button" className="hov-bd2" onClick={onClick} style={{ height: 30, padding: '0 12px', border: `1px solid ${primary ? '#171717' : '#eaeaea'}`, borderRadius: 8, background: primary ? '#171717' : '#fff', cursor: 'pointer', font: '500 12.5px/1 var(--font-sans)', color: primary ? '#fff' : '#171717', transition: 'border-color 120ms' }}>{children}</button>;
}

/* ------------------------------------------------------------------------------ find in a file drawn here */
// CSS Custom Highlights over the view's text nodes (the page's DOM is never changed), as PaperView does for a pdf.
const FIND = 'stage-find', FIND_ON = 'stage-find-cur';
const highlights = () => (typeof CSS !== 'undefined' && CSS.highlights && typeof Highlight === 'function' ? CSS.highlights : null);
function textRanges(root, query) {
  const needle = String(query || '').toLowerCase();
  if (!root || !needle.trim()) return [];
  const ranges = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const hay = node.data.toLowerCase();
    for (let at = hay.indexOf(needle); at >= 0; at = hay.indexOf(needle, at + needle.length)) {
      const range = document.createRange();
      range.setStart(node, at);
      range.setEnd(node, at + needle.length);
      ranges.push(range);
    }
  }
  return ranges;
}
function paintRanges(ranges, active, scroller) {
  const h = highlights();
  if (h) {
    h.set(FIND, new Highlight(...ranges.filter((range, i) => i !== active)));
    const on = new Highlight(...(ranges[active] ? [ranges[active]] : []));
    on.priority = 1;
    h.set(FIND_ON, on);
  }
  const range = ranges[active];
  if (!range || !scroller) return;
  const box = scroller.getBoundingClientRect(), r = range.getBoundingClientRect();
  if (r.top < box.top + 24 || r.bottom > box.bottom - 24) scroller.scrollTop += r.top - box.top - scroller.clientHeight / 3;
}
const clearRanges = () => { const h = highlights(); if (h) { h.delete(FIND); h.delete(FIND_ON); } };

/* --------------------------------------------------------------------------------------------------- Stage */

// The pdf an answer is for, as the workspace keeps it ({ rowId } or { url }), and whether a tab's pdf is it.
const pdfWhere = (p) => (p.rowId ? { rowId: p.rowId } : { url: p.url });
const samePdf = (p, where) => !!p && !!where && (where.rowId ? p.rowId === where.rowId : !p.rowId && !!where.url && p.url === where.url);
const Stage = React.forwardRef(function Stage({ projectId, visible, full, onFull, onShow, onPage, onFront, save, library, inRail, onError, onOpenItem, mentionItems, onMentionOpen, listFolder, fileState, onOpenFile, pendingAsks, onAsk, onStopAsk, onDismissAsk, onContinueAsk, onCopyText }, ref) {
  const [tabs, setTabs] = React.useState(() => [blankTab()]);
  const [activeId, setActiveId] = React.useState(() => null);
  const [draft, setDraft] = React.useState('');
  const [menu, setMenu] = React.useState(null); // { x, y }
  const [device, setDevice] = React.useState('fit');
  const [importing, setImporting] = React.useState(false); // the "Import sign-ins…" picker is open (MATH-18)
  const [customW, setCustomW] = React.useState('390');
  const [occluded, setOccluded] = React.useState(false);
  const [snapshot, setSnapshot] = React.useState(null);
  const [logins, setLogins] = React.useState([]); // HTTP authentication a page (or a popup) is waiting on
  const [typing, setTyping] = React.useState(false); // the address has the keyboard: its list is open, Save steps aside
  const [pick, setPick] = React.useState(0); // the row of the address list Enter takes
  const [found, setFound] = React.useState(null); // the library's answer for a typed place: { input, row }
  const [saving, setSaving] = React.useState(false); // the Save card is open
  const [sendingPdf, setSendingPdf] = React.useState(null); // Send to reMarkable's card: { name, bytes, rowId, input, tabId, pdfSeq, seq }
  const [rowKinds, setRowKinds] = React.useState({}); // library row → what it is to reMarkable (rowKind), as asked
  const [finding, setFinding] = React.useState(false); // the find card is open
  const [findText, setFindText] = React.useState('');
  const [matches, setMatches] = React.useState(null); // { matches, active } in the tab in front
  const [findFocus, setFindFocus] = React.useState(0); // bumped to put the keyboard in the find field
  const [hover, setHover] = React.useState(null); // { id, left, width }: the tab whose card shows
  const hoverTimer = React.useRef(0);
  const hoverWarm = React.useRef(false);
  const warmTimer = React.useRef(0);
  const findRef = React.useRef(null);
  const paperRef = React.useRef(null);
  const rootRef = React.useRef(null);
  const viewRef = React.useRef(null); // a file drawn here: what find searches, and what scrolls
  const fileRanges = React.useRef({ ranges: [], active: -1, query: '' });
  const pdfSeq = React.useRef(0);
  const keys = React.useRef(null); // the handlers the key listeners call, current every render
  const jumped = React.useRef(null); // { tabId, text }: a link's passage just found, which the find card's next run keeps
  const saveCard = React.useRef(null);
  const saveButton = React.useRef(null);
  const addressRef = React.useRef(null);
  const menuRef = React.useRef(null);
  const slotRef = React.useRef(null); // where the page goes
  // What claim() decides from: the tabs and the one in front as of the last decision, not the last render — several
  // things opened in one go (files picked together) each see where the one before them went.
  const tabsRef = React.useRef(tabs);
  const frontRef = React.useRef(activeId);
  tabsRef.current = tabs;
  frontRef.current = activeId;

  const tab = tabs.find((t) => t.id === activeId) || tabs[0];
  const activeIndex = tabs.indexOf(tab);
  const pdf = tab.pdf || null; // { url, input, name, under, seq, loading, bytes, error, marks (undefined until read), rowId }
  const view = !pdf && tab.file && VIEWS.has(tab.file.kind) ? tab.file : null; // a file drawn here
  const k = kindOf(tab.url); // under a pdf: the page that led to it
  const page = !pdf && !view && (isPage(k) || !!tab.opened);
  const blank = !pdf && !view && !page && k.kind === 'blank' && !tab.restore; // (a tab given back shows nothing while it opens)
  const web = tab.web;
  const failed = page && web && web.error ? web.error : null;
  // A sandbox's preview waits for its first page (2026-10-04): asleep, it can take seconds to wake and its first load can
  // fail meanwhile. "Waking…" shows in its place, a failed load is retried, and after a minute Couldn't load says so.
  const sandboxes = useSandboxes();
  const previewId = page && sandboxes ? previewLibraryId(sandboxes.items, (failed && failed.url) || (web && web.url) || tab.url) : null;
  const previewRow = previewId && sandboxes.library ? sandboxes.library.find((row) => row.id === previewId) || null : null;
  const [waits, setWaits] = React.useState({}); // tab id → when its preview's first page began to be waited for
  const [now, setNow] = React.useState(() => Date.now());
  const waitSince = waits[tab.id] || 0;
  const wait = previewWait({ preview: !!previewId, web, since: waitSince, now: Math.max(now, waitSince) });
  const showing = visible && page && !failed && !occluded && !wait;
  usePreviewTouch((web && web.url) || tab.url, visible && page); // a repository's live preview in use stays awake
  // Where the tab is, as the address field shows it: a file by its path (a docx too, though a page made from it is shown).
  const shownUrl = pdf ? (pdf.input || pdf.url) : tab.file && tab.file.path ? tab.file.path : tab.restore && tab.restore.address ? tab.restore.address : tab.url;
  const shownDraft = stripScheme(shownUrl);

  const update = React.useCallback((id, fn) => setTabs((current) => current.map((t) => (t.id === id ? fn(t) : t))), []);

  // The thing in front, for the library: its address or path, and for a pdf from the web its bytes (Save keeps a copy).
  const pageInput = pdf ? (pdf.error ? null : pdf.input || (DISK_URL.test(pdf.url) ? stripScheme(pdf.url) : pdf.url))
    : view ? (view.path && view.kind !== 'error' && view.kind !== 'loading' ? view.path : null)
      : tab.file && tab.file.kind === 'doc' ? tab.file.path
        : page ? ((web && web.url) || tab.url) : null;
  const pageTitle = tab.row ? tab.row.name : pdf ? pdf.name : view || (tab.file && tab.file.kind === 'doc') ? (tab.file.name || basename(pageInput)) : page ? ((web && web.title) || stripScheme(pageInput || '')) : '';
  const savable = !!pageInput && !/^about:/i.test(pageInput) && kindOf(pdf ? pdf.url : tab.url).kind !== 'local';
  const pdfBytes = pdf && !pdf.rowId && WEB_URL.test(pdf.url) ? pdf.bytes : null;
  // a page from the web in this tab's view, which Save can keep whole (MATH-17): the tab names it to main
  const webPage = page && WEB_URL.test(pageInput || '');
  // Boxes (MATH-70): a page whose ink is kept can be boxed; which tab has the drawing layer, and the box last removed.
  const boxable = page && !failed && !wait && !!web && (WEB_URL.test(web.url || '') || DISK_URL.test(web.url || '')) && !isPreviewAddress(web.url || '');
  const [boxing, setBoxing] = React.useState(null);
  const [boxRemoved, setBoxRemoved] = React.useState(null); // { id (the tab), markId }
  const boxTimer = React.useRef(0);
  React.useEffect(() => {
    if (!api.onBrowserBoxing) return undefined;
    const offBoxing = api.onBrowserBoxing(({ id, on }) => setBoxing((current) => (on ? id : current === id ? null : current)));
    const offRemoved = api.onBrowserBoxRemoved(({ id, markId }) => {
      clearTimeout(boxTimer.current);
      setBoxRemoved({ id, markId });
      boxTimer.current = setTimeout(() => setBoxRemoved(null), REMOVED_MS);
    });
    const offRestored = api.onBrowserBoxRestored(({ id }) => setBoxRemoved((current) => (current && current.id === id ? null : current)));
    return () => { offBoxing(); offRemoved(); offRestored(); clearTimeout(boxTimer.current); };
  }, []);
  React.useEffect(() => { if (onPage) onPage(savable ? { input: pageInput, title: pageTitle || stripScheme(pageInput), bytes: pdfBytes || null, tabId: tab.id, webPage } : null); }, [savable, pageInput, pageTitle, pdfBytes, tab.id, webPage, onPage]);
  React.useEffect(() => { if (onFront) onFront(tab.item || null); }, [tab.item, onFront]);
  React.useEffect(() => { setSaving(false); }, [tab.id, pageInput]);
  // The card closes on a press anywhere else.
  React.useEffect(() => {
    if (!saving) return undefined;
    const away = (event) => { if (![saveCard, saveButton].some((r) => r.current && r.current.contains(event.target))) setSaving(false); };
    document.addEventListener('mousedown', away, true);
    return () => document.removeEventListener('mousedown', away, true);
  }, [saving]);
  const saveState = save && savable ? save.state : null;
  const onSaveClick = () => {
    if (saveState === 'none') setSaving((open) => !open);
    else if (saveState === 'lib') save.onLink().catch(() => {});
  };

  React.useEffect(() => {
    if (!menu) return undefined;
    const close = (event) => { if (menuRef.current && !menuRef.current.contains(event.target)) setMenu(null); };
    window.addEventListener('mousedown', close);
    return () => window.removeEventListener('mousedown', close);
  }, [menu]);

  /* -------------------------------------------------------------------------------------------- tabs */

  const dropTab = React.useCallback((id) => {
    setTabs((current) => {
      const at = current.findIndex((t) => t.id === id);
      if (at < 0) return current;
      const rest = current.filter((t) => t.id !== id);
      if (!rest.length) {
        const fresh = blankTab();
        setActiveId(fresh.id);
        return [fresh];
      }
      const gone = current[at];
      setActiveId((active) => {
        const front = current.findIndex((t) => t.id === (active || current[0].id));
        if (front !== at) return active;
        const back = rest.find((t) => t.id === gone.from); // back to the tab that opened it, as a sign-in expects
        return back ? back.id : rest[afterClose(current.length, front, at)].id;
      });
      return rest;
    });
  }, []);

  // A tab a page opened arrives with its view already made (id); nothing else is loaded here.
  const adoptTab = React.useCallback((url, id, from) => {
    const next = { ...blankTab(), id, url: url || 'about:blank', from: from || null, opened: true };
    setTabs((current) => [...current, next]);
    setActiveId(next.id);
  }, []);

  // Where something being opened goes (model/stage.js placeTab); answers the tab's id, or null when it was open already.
  // `find`: a passage to find there once it is ready, given to the new tab or to the one that comes forward; `to`, where its section ends.
  // `newTab` (a ⌘-click on a link): a tab of its own, even when one shows it already. `sections`: an @discover guide's for
  // the paper, which come with the passage and replace the tab's (model/stage.js withPassage).
  const claim = (key, find = '', to = '', { newTab = false, sections = null, also = '' } = {}) => {
    const current = tabsRef.current;
    const front = Math.max(0, current.findIndex((t) => t.id === (frontRef.current || current[0].id)));
    const place = placeTab(current, front, key, { newTab, also });
    if (place.focus != null) {
      const id = current[place.focus].id;
      frontRef.current = id;
      setActiveId(id);
      if (find) update(id, (t) => withPassage(t, find, to, sections));
      return null;
    }
    const fresh = withPassage({ ...blankTab(), claimed: true }, find, to, sections);
    if (place.replace != null) {
      const old = current[place.replace];
      quiet(api.browserClose(old.id));
      tabsRef.current = current.map((t) => (t.id === old.id ? fresh : t));
      setTabs((list) => list.map((t) => (t.id === old.id ? fresh : t)));
    } else {
      tabsRef.current = [...current, fresh];
      setTabs((list) => [...list, fresh]);
    }
    frontRef.current = fresh.id;
    setActiveId(fresh.id);
    return fresh.id;
  };

  /* -------------------------------------------------------------------------------------------- loading */

  // A page main refuses (a file outside the home directory) fails like one that did not load.
  const load = (id, url) => api.browserOpen(id, url).catch((error) => update(id, (t) => ({ ...t, web: { ...(t.web || {}), id, url, error: { code: 0, description: errorMessage(error), url } } })));

  // A pdf's ink: a library row's own, else kept by the pdf's address.
  const readInk = (id, bytes, rowId, url) => {
    const read = rowId ? api.readAnnotations(rowId) : api.readPageAnnotations(url);
    read.catch(() => null).then((marks) => update(id, (t) => (t.pdf && t.pdf.bytes === bytes ? { ...t, pdf: { ...t.pdf, marks: marks || {} } } : t)));
  };

  // What main read at a path (stage-file) goes into the tab: a pdf to the viewer, a page (or a docx made one) to the view,
  // anything else drawn here.
  const apply = (id, result, rowId) => {
    if (result.kind === 'pdf') {
      const seq = (pdfSeq.current += 1);
      update(id, (t) => ({ ...t, url: 'about:blank', file: null, pdfForward: null, pdf: { url: result.url, input: t.row ? (t.row.url || t.row.path) : result.path, name: t.row ? t.row.name : result.name, under: 'about:blank', seq, loading: false, bytes: result.bytes, error: '', marks: undefined, rowId: rowId || null } }));
      readInk(id, result.bytes, rowId, result.url);
      return;
    }
    if (result.kind === 'page' || result.kind === 'doc') {
      update(id, (t) => ({ ...t, url: result.url, pdf: null, pdfForward: null, opened: false, file: result.kind === 'doc' ? result : null, web: t.web ? { ...t.web, error: null } : null }));
      load(id, result.url);
      return;
    }
    update(id, (t) => ({ ...t, url: 'about:blank', pdf: null, pdfForward: null, file: result }));
  };

  const readPath = (id, input, rowId) => {
    update(id, (t) => ({ ...t, url: 'about:blank', pdf: null, pdfForward: null, file: { kind: 'loading', path: input, name: basename(input) } }));
    api.stageFile(projectId, input)
      .then((result) => apply(id, result, rowId)) // a tab closed meanwhile is simply not there to update
      .catch((error) => update(id, (t) => ({ ...t, file: { kind: 'error', path: input, name: basename(input), message: errorMessage(error) } })));
  };

  // A library row in a tab of its own: its file when it has one (read here), else its address, else its folder.
  const showRow = (id, row) => {
    if (isGithubSignIn(row.url) && !row.path) { quiet(api.openExternal(row.url)); return; }
    update(id, (t) => ({ ...t, item: row.id, row }));
    if (row.type === 'pdf' && row.path) {
      const seq = (pdfSeq.current += 1);
      update(id, (t) => ({ ...t, url: 'about:blank', file: null, pdf: { url: row.url || fileUrl(row.path), input: row.url || row.path, name: row.name, under: 'about:blank', seq, loading: true, bytes: null, error: '', marks: undefined, rowId: row.id } }));
      api.readLibraryFile(row.id).then((file) => {
        update(id, (t) => (t.pdf && t.pdf.seq === seq ? { ...t, pdf: { ...t.pdf, loading: false, bytes: file.bytes } } : t));
        readInk(id, file.bytes, row.id, null);
      }).catch((error) => update(id, (t) => (t.pdf && t.pdf.seq === seq ? { ...t, pdf: { ...t.pdf, loading: false, error: errorMessage(error) } } : t)));
      return;
    }
    // (a picture kept with the address it was dragged from shows its copy, as a saved pdf does: MATH-19)
    if (row.url && !(row.path && (row.type === 'html' || row.type === 'image'))) { update(id, (t) => ({ ...t, url: row.url, file: null, pdf: null })); load(id, row.url); return; }
    if (row.path) readPath(id, row.path, row.id);
    else if (row.folder_path) readPath(id, row.folder_path, row.id);
  };

  // Typed (or picked) into the tab in front: a path is read, anything else is where the page goes.
  const navigate = async (id, input) => {
    if (isGithubSignIn(kindOf(input).url)) { await api.openExternal(kindOf(input).url); setTyping(false); setDraft(stripScheme(tab.url)); return; }
    update(id, (t) => ({ ...t, pdf: null, pdfForward: null, item: null, row: null }));
    let next = kindOf(input);
    const path = next.kind === 'disk' || next.kind === 'file' || (!hasScheme(input) && next.kind !== 'local' && next.kind !== 'sandbox' && next.kind !== 'blank' && looksLikePlace(input) && /^[.~/]|\.[a-z0-9]{1,8}(?:[#?].*)?$/i.test(input) && !/\.(com|org|net|io|dev|ai|app|edu|gov|co|xyz|me)(?:[/:#?].*)?$/i.test(input));
    if (path) {
      const place = next.kind === 'disk' ? next.url : input;
      try {
        const result = await api.stageFile(projectId, place);
        apply(id, result, null);
        setDraft(stripScheme(result.path || place));
        return;
      } catch (error) {
        if (next.kind === 'file' || next.kind === 'disk') {
          update(id, (t) => ({ ...t, url: 'about:blank', file: { kind: 'error', path: input, name: basename(input), message: errorMessage(error) } }));
          setDraft(input);
          return;
        }
        next = kindOf(`https://${input}`); // `report.html` that is no file here: a site after all
      }
    }
    if (isPage(next)) load(id, next.url);
    update(id, (t) => ({ ...t, opened: false, file: null, url: next.url || input, web: isPage(next) && t.web ? { ...t.web, error: null } : t.web }));
    setDraft(stripScheme(next.url || input));
  };

  // Opened from elsewhere — the sidebar, an @mention, a link in the document or the terminal, the all-projects screen.
  const openRow = (row, find = '', to = '', options = {}) => {
    if (isGithubSignIn(row.url) && !row.path) { quiet(api.openExternal(row.url)); return; }
    // Open already (MATH-16): its tab comes to the front as it was left, where it was read to; ⌘-click opens another.
    const where = row.path ? fileUrl(row.path) : row.url || '', also = where && addressKey(where) ? `l:${addressKey(where)}` : '';
    const id = claim(`i:${row.id}`, find, to, { ...options, also });
    if (id) showRow(id, row);
  };
  // A link with a passage to a library row opens the row (its ink shows); any link opens its address without the passage.
  // `{ newTab: true }`: a ⌘-click, in a tab of its own.
  const openInput = (input, options = {}) => {
    const plan = linkPlan(input, library);
    if (plan.row) { openRow(plan.row, plan.find, plan.to, options); return; }
    const k0 = kindOf(plan.address);
    if (isGithubSignIn(k0.url)) { quiet(api.openExternal(k0.url)); return; }
    const id = claim(plan.key, plan.find, plan.to, options);
    if (id) void navigate(id, plan.address);
  };
  // A file inside a library folder, mentioned (MATH-22): its tab, as a file from the computer has, unless one is open already.
  const openFile = (file, options = {}) => {
    const id = claim(`l:${addressKey(fileUrl(file))}`, '', '', options);
    if (id) readPath(id, file, null);
  };
  // Files from the computer open as tabs of their own; + Save is what puts them in the library. Past 15, the rest are left.
  const openPaths = (paths) => {
    let room = MAX_TABS - tabsRef.current.filter((t) => tabKey(t) || t.pdf || t.file).length;
    for (const file of paths) {
      if (room <= 0) break;
      const id = claim(`l:${addressKey(fileUrl(file))}`);
      if (id) { readPath(id, file, null); room -= 1; }
    }
  };
  const chooseFiles = async () => {
    setTyping(false);
    if (addressRef.current) addressRef.current.blur();
    try { const paths = await api.pickLibraryPaths(); if (paths && paths.length) openPaths(paths); } catch (error) { if (onError) onError(error); }
  };

  const newTab = () => {
    if (tabsRef.current.length >= MAX_TABS) return;
    const fresh = blankTab();
    setTabs((current) => [...current, fresh]);
    setActiveId(fresh.id);
    setDraft('');
    setFinding(false);
    // the caret goes to the address, once the new tab is in front
    const go = () => { if (addressRef.current) { addressRef.current.focus({ preventScroll: true }); addressRef.current.select(); } };
    requestAnimationFrame(() => { go(); requestAnimationFrame(go); });
  };
  const closeTab = (id) => { quiet(api.browserClose(id)); dropTab(id); setHover(null); };
  const select = (t) => { setActiveId(t.id); setMenu(null); setTyping(false); setHover(null); };

  // ⌘1–9 (MATH-12, 2026-10-06): the Stage's n-th tab, when the Stage is what was last clicked (Workspace decides).
  const tabAt = (index) => { const t = tabs[index]; if (!t) return false; select(t); return true; };
  // What is in front (MATH-27, 2026-10-06), for @bart's <stage>: { rowId, url, page, kind }, a pdf's page the one in view.
  // A web page (MATH-54) is { kind: 'web', url, title, tab }: where the tab is now and what the page calls itself (main finds
  // the library's row and the ink by the address; a sandbox preview's is not kept), and the tab, whose selection and
  // picture main asks for (build 3a).
  const front = () => {
    const t = tabsRef.current.find((x) => x.id === frontRef.current) || tabsRef.current[0];
    if (!t) return null;
    const p = t.pdf;
    if (!p && !t.file && (isPage(kindOf(t.url)) || t.opened)) { // a file (one drawn here, a docx made a page) is no web page
      const url = (t.web && t.web.url) || t.url;
      if (url && url !== 'about:blank') return url.length > 4096 ? null : { kind: 'web', url, title: (t.web && t.web.title) || (t.row && t.row.name) || '', tab: t.id };
    }
    if (!p || p.error || (!p.rowId && !p.url)) return { rowId: null, url: null, page: 1, kind: t.file ? 'file' : 'page' };
    if (!p.rowId && String(p.url).length > 4096) return null; // past what main takes
    const viewer = paperRef.current;
    const page = viewer && typeof viewer.currentPage === 'function' ? viewer.currentPage() : 0;
    return { rowId: p.rowId || null, url: p.rowId ? null : p.url, page: page > 0 ? page : 1, kind: 'pdf' };
  };
  React.useImperativeHandle(ref, () => ({ openRow, openInput, openPaths, openFile, newTab, closeTab: () => closeTab(tab.id), tabAt, front }));

  /* ------------------------------------------------------------------- @bart on a highlight (MATH-27) */
  // A finished answer onto its mark: the viewer in front adds it when it shows that pdf, and every tab holding the pdf
  // takes it, so none brought forward later saves its ink without it. Main has put it in the ink kept on disk already
  // (library.addMarkAnswer). A mark gone meanwhile takes nothing, and an answer already there is not added again: the
  // window that asked hears it twice (the ask's answer and main's paper-ask-done).
  const landAnswer = (where, page, markId, entry) => {
    const front = tabsRef.current.find((t) => t.id === frontRef.current) || tabsRef.current[0];
    const viewer = paperRef.current;
    if (front && samePdf(front.pdf, where) && viewer && typeof viewer.addAsk === 'function') viewer.addAsk(page, markId, entry);
    setTabs((current) => {
      let changed = false;
      const next = current.map((t) => {
        if (!t.pdf || !t.pdf.marks || !samePdf(t.pdf, where)) return t;
        const marks = withAsk(t.pdf.marks, page, markId, entry);
        if (marks === t.pdf.marks) return t;
        changed = true;
        return { ...t, pdf: { ...t.pdf, marks } };
      });
      return changed ? next : current;
    });
  };
  // A library row's file changed under an open tab (main's engelbart:library-files: a reMarkable notebook synced, or the
  // tablet's ink come onto a PDF sent from here): the tab reads it again as the same paper (its seq) with new bytes, so
  // PaperView keeps its place and its ink. Not while a note is being typed in the Stage: once the typing stops.
  const staleTabs = React.useRef(new Set());
  const refreshStale = React.useCallback(() => {
    const active = document.activeElement;
    const typing = !!active && !!rootRef.current && rootRef.current.contains(active) && (active.tagName === 'TEXTAREA' || active.tagName === 'INPUT' || active.isContentEditable);
    for (const id of [...staleTabs.current]) {
      if (typing && id === frontRef.current) continue;
      staleTabs.current.delete(id);
      const t = tabsRef.current.find((x) => x.id === id);
      if (!t || !t.pdf || !t.pdf.rowId || t.pdf.loading) continue;
      const { seq, rowId } = t.pdf;
      api.readLibraryFile(rowId)
        .then((file) => update(id, (x) => (x.pdf && x.pdf.seq === seq && x.pdf.rowId === rowId ? { ...x, pdf: { ...x.pdf, bytes: file.bytes } } : x)))
        .catch(() => {}); // the tab keeps what it shows
    }
  }, [update]);
  React.useEffect(() => {
    if (!api.onLibraryFiles) return undefined;
    const off = api.onLibraryFiles((told) => {
      const ids = new Set(told && Array.isArray(told.ids) ? told.ids : []);
      for (const t of tabsRef.current) if (t.pdf && t.pdf.rowId && ids.has(t.pdf.rowId)) staleTabs.current.add(t.id);
      for (const id of ids) setRowKinds((kinds) => (id in kinds ? { ...kinds, [id]: undefined } : kinds)); // asked again
      refreshStale();
    });
    const later = () => setTimeout(refreshStale, 0);
    document.addEventListener('focusout', later);
    return () => { off(); document.removeEventListener('focusout', later); };
  }, [refreshStale]);
  // What the pdf in front is to reMarkable (a document of the tablet's is not sent to it again).
  const kindRow = pdf && pdf.rowId ? pdf.rowId : null;
  const kindKnown = kindRow ? rowKinds[kindRow] !== undefined : true;
  React.useEffect(() => {
    if (!kindRow || kindKnown || !api.remarkableRowKind) return undefined;
    let live = true;
    api.remarkableRowKind(kindRow).then((kind) => { if (live) setRowKinds((kinds) => ({ ...kinds, [kindRow]: kind || null })); }).catch(() => {});
    return () => { live = false; };
  }, [kindRow, kindKnown]);
  // Send to reMarkable saved a pdf the library did not hold (main's rowForSend): its tab is that row's from now on, so
  // its ink is kept by the row, where the tablet's comes back.
  const adoptRow = (tabId, seq, rowId) => {
    if (rowId) update(tabId, (t) => (t.pdf && t.pdf.seq === seq && !t.pdf.rowId ? { ...t, pdf: { ...t.pdf, rowId } } : t));
  };
  // How a question from a highlight ended, told to every window by main: its answer lands here too (landAnswer).
  const landRef = React.useRef(landAnswer);
  landRef.current = landAnswer;
  React.useEffect(() => {
    if (!api.onPaperAskDone) return undefined;
    return api.onPaperAskDone((done) => {
      // a web page's mark (MATH-54, `page` null) is no pdf's: main has put its answer in the page's ink
      if (done && done.entry && done.markId && done.page != null && (done.rowId || done.url)) landRef.current(done.rowId ? { rowId: done.rowId } : { url: done.url }, done.page, done.markId, done.entry);
    });
  }, []);
  // A box's card (MATH-70 build 2): its asks and Stops, through what the workspace gave; what runs goes back to main.
  const boxHandlers = React.useRef(null);
  boxHandlers.current = { onAsk, onStopAsk, onDismissAsk, pendingAsks };
  React.useEffect(() => {
    if (!api.onBrowserBoxAsk) return undefined;
    const offAsk = api.onBrowserBoxAsk(({ markId, url, title, question, note, turns }) => {
      const h = boxHandlers.current;
      if (h.onAsk && markId && url && question) void h.onAsk({ markId, source: 'web', url, question, note: note || '', turns: turns || [], quote: '', pageText: '', paper: title || '' });
    });
    const offStop = api.onBrowserBoxStop(({ askId }) => {
      const h = boxHandlers.current, held = (h.pendingAsks || []).find((p) => p && p.askId === askId);
      if (held && held.error != null) { if (h.onDismissAsk) h.onDismissAsk(askId); } else if (h.onStopAsk && askId) h.onStopAsk(askId);
    });
    return () => { offAsk(); offStop(); };
  }, []);
  const boxAsks = React.useMemo(() => (pendingAsks || []).filter((p) => p && p.source === 'web' && p.askId && p.markId), [pendingAsks]);
  React.useEffect(() => { if (api.browserBoxAsks) quiet(api.browserBoxAsks(boxAsks)); }, [boxAsks]);
  const askFromPaper = async (p, ask) => {
    if (!onAsk || !p) return;
    const where = pdfWhere(p);
    const entry = await onAsk({ ...ask, ...where, paper: p.name || '' });
    if (entry) landAnswer(where, ask.page, ask.markId, entry);
  };

  /* ------------------------------------------------------------------- kept across ⌘R and quitting (MATH-10) */
  // Main keeps the project's tabs (model/stage.js stageSnapshot) a moment after they change, and at once when the page
  // goes away (⌘R, quitting: no cleanup runs then) or the project closes. Nothing is kept before the kept ones have come
  // back, so the blank tab the Stage starts with never takes their place. They come back (restoreTabs) unshown, each a
  // blank tab with `restore` ({ item } or { address }, and its title), behind anything opened meanwhile.
  const libraryRef = React.useRef(library);
  libraryRef.current = library;
  const restored = React.useRef(false);
  const stageSent = React.useRef(''); // the last tabs given to main, as JSON
  const stageQueued = React.useRef(null);
  const stageTimer = React.useRef(0);
  const flushStage = React.useCallback(() => {
    clearTimeout(stageTimer.current);
    stageTimer.current = 0;
    const value = stageQueued.current;
    stageQueued.current = null;
    if (value) quiet(api.setStage(projectId, value));
  }, [projectId]);
  React.useEffect(() => {
    let live = true;
    api.stage(projectId).catch(() => null).then((saved) => { // a read that fails gives nothing back
      if (!live) return;
      restored.current = true;
      // Merged into the tabs as they are when React applies it (a file may have landed since the last render), one tab
      // made per kept entry however often that is; the tab in front is the kept one, or stays the one it was.
      const made = new Map();
      const make = (entry) => { if (!made.has(entry)) made.set(entry, { ...blankTab(), restore: { ...entry } }); return made.get(entry); };
      let front = null;
      setTabs((current) => {
        const plan = restoreTabs(current, saved, libraryRef.current, make);
        const was = current.find((t) => t.id === frontRef.current) || current[0];
        front = plan.front || (was ? was.id : null);
        return plan.tabs;
      });
      setActiveId((active) => front || active);
    });
    window.addEventListener('pagehide', flushStage);
    return () => { live = false; window.removeEventListener('pagehide', flushStage); flushStage(); };
  }, [projectId, flushStage]);
  React.useEffect(() => {
    if (!restored.current) return;
    const value = stageSnapshot(tabs, activeId);
    const text = JSON.stringify(value);
    if (text === stageSent.current) return;
    stageSent.current = text;
    stageQueued.current = value;
    clearTimeout(stageTimer.current);
    stageTimer.current = setTimeout(flushStage, STAGE_SAVE_MS);
  }, [tabs, activeId, flushStage]);
  // A tab given back opens when it comes forward: a library row as the sidebar opens it (one gone from the library closes),
  // a place as if typed. A place keeps `restore` until it is there, so it is kept and titled meanwhile.
  React.useEffect(() => {
    const entry = tab.restore;
    if (!entry || entry.opening) return;
    const id = tab.id;
    if (entry.item) {
      const row = (libraryRef.current || []).find((r) => r.id === entry.item);
      update(id, (t) => ({ ...t, restore: null }));
      if (row && onStage(row)) showRow(id, row); else dropTab(id);
      return;
    }
    update(id, (t) => ({ ...t, restore: { ...entry, opening: true } }));
    navigate(id, entry.address).catch(() => {}).then(() => update(id, (t) => (t.restore ? { ...t, restore: null } : t)));
  }, [tab.id, tab.restore]); // eslint-disable-line react-hooks/exhaustive-deps

  // A tab's pdf from a page: loading, then its bytes (and the ink kept for its address) or why not. A new one is a new viewer.
  const receivePdf = React.useCallback((got) => {
    const fresh = (pdfSeq.current += 1);
    setTabs((current) => current.map((t) => {
      if (t.id !== got.id) return t;
      const seq = t.pdf && t.pdf.loading && t.pdf.url === got.url ? t.pdf.seq : fresh;
      const rowId = t.row && t.row.url && addressKey(t.row.url) === addressKey(got.url) ? t.row.id : null; // a library row that is this pdf's address
      const next = { url: got.url, input: got.url, name: t.row && rowId ? t.row.name : got.name, under: got.under || 'about:blank', seq, loading: !!got.loading, bytes: got.bytes || null, error: got.error || '', marks: undefined, rowId };
      const was = t.pdf || t.pdfForward, same = !!t.pendingFind || (was && addressKey(was.url) === addressKey(got.url)); // a guide's sections are its paper's
      return { ...(same ? t : noSections(t)), url: next.under, pdf: next, pdfForward: null, file: null };
    }));
    if (!got.bytes) return;
    api.readPageAnnotations(got.url).catch(() => null).then((marks) => setTabs((current) => current.map((t) => (
      t.id === got.id && t.pdf && t.pdf.bytes === got.bytes ? { ...t, pdf: { ...t.pdf, marks: marks || {} } } : t
    ))));
  }, []);

  // The page reports where it is; a tab showing a file keeps its own address. When the page under a pdf goes somewhere
  // else (a reload answered with a page), the pdf is gone, and so is Forward to one.
  React.useEffect(() => {
    const offState = api.onBrowserState((state) => setTabs((current) => current.map((t) => {
      if (t.id !== state.id) return t;
      const next = { ...t, web: state, url: (t.opened || isPage(kindOf(t.url))) && state.url ? state.url : t.url };
      const moved = (under) => !state.loading && (state.url || 'about:blank') !== (under || 'about:blank');
      // (a pdf that no page led to — from disk or the library — is not the page's to take away)
      if (t.pdf && !t.pdf.loading && t.pdf.under !== 'about:blank' && moved(t.pdf.under)) next.pdf = null;
      if (t.pdfForward && moved(t.pdfForward.under)) next.pdfForward = null;
      // a page that went elsewhere by a link is no longer the library row the tab was opened with
      if (t.row && t.row.url && state.url && !state.loading && !t.pdf && addressKey(state.url) !== addressKey(t.row.url) && !(t.file && t.file.kind === 'doc')) { next.item = null; next.row = null; }
      if (t.file && t.file.kind === 'doc' && state.url && !state.loading && !DISK_URL.test(state.url)) next.file = null;
      return next;
    })));
    const offPdf = api.onBrowserPdf(receivePdf);
    const offFound = api.onBrowserFound((result) => { const h = keys.current; if (h && h.finding && result.id === h.tabId) setMatches({ matches: result.matches, active: result.active }); });
    const offShortcut = api.onBrowserShortcut(({ name, tab: from }) => { if (keys.current) keys.current.shortcut(name, from); });
    const offOpen = api.onBrowserOpenTab(({ url, id, from }) => adoptTab(url, id, from));
    const offClosed = api.onBrowserClosed(({ id }) => dropTab(id));
    const offLogin = api.onBrowserLogin((request) => setLogins((current) => [...current, request]));
    const offFocus = api.onBrowserFocusAddress(() => { if (addressRef.current) { addressRef.current.focus(); addressRef.current.select(); } });
    const onAsk = (event) => { if (event.detail && event.detail.url && keys.current) keys.current.openInput(event.detail.url); }; // a link clicked in the terminal
    window.addEventListener(OPEN_IN_BROWSER, onAsk);
    return () => { offState(); offPdf(); offFound(); offShortcut(); offOpen(); offClosed(); offLogin(); offFocus(); window.removeEventListener(OPEN_IN_BROWSER, onAsk); quiet(api.browserCloseAll()); };
  }, [adoptTab, dropTab, receivePdf]);

  // The address follows the tab unless it is being typed in.
  React.useEffect(() => {
    if (document.activeElement !== addressRef.current) setDraft(shownDraft);
  }, [tab.id, shownDraft]);

  // Anything marked data-overlay that reaches over the page would sit under the native view.
  React.useEffect(() => {
    if (!visible || !page) { setOccluded(false); return undefined; }
    let timer = 0; // a timer, not a frame: frames stop while the window is covered
    const check = () => {
      timer = 0;
      const slot = slotRef.current;
      if (!slot) return;
      const r = slot.getBoundingClientRect();
      let hit = false;
      for (const overlay of document.querySelectorAll('[data-overlay]')) {
        if (overlay.dataset.findBar) continue; // the find card sits in a band above the page, never over it
        const b = overlay.getBoundingClientRect();
        if (b.width && b.height && b.left < r.right && b.right > r.left && b.top < r.bottom && b.bottom > r.top) { hit = true; break; }
      }
      setOccluded(hit);
    };
    const schedule = () => { if (!timer) timer = setTimeout(check, 16); };
    const observer = new MutationObserver(schedule);
    observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['style', 'data-overlay'] });
    check();
    return () => { observer.disconnect(); clearTimeout(timer); };
  }, [visible, page, tab.id]);

  // The view follows the placeholder; one page shows at a time, and none when there is no place for it.
  React.useLayoutEffect(() => {
    let cancelled = false;
    if (!showing) {
      quiet(api.browserHide({ snapshot: visible && page && !failed && !wait && occluded }).then((picture) => { if (!cancelled) setSnapshot(picture || null); }));
      return () => { cancelled = true; };
    }
    const slot = slotRef.current;
    const place = () => {
      const r = slot.getBoundingClientRect();
      if (r.width < 1 || r.height < 1) { quiet(api.browserHide()); return; }
      // The page stops short of the window's right and bottom edges, where the resize strips are (WindowEdges.jsx).
      const width = Math.min(r.width, window.innerWidth - WINDOW_EDGE - r.left), height = Math.min(r.height, window.innerHeight - WINDOW_EDGE - r.top);
      quiet(api.browserShow(tab.id, { x: r.left, y: r.top, width, height }).then(() => { if (!cancelled) setSnapshot(null); }));
    };
    const observer = new ResizeObserver(place);
    observer.observe(slot);
    if (slot.parentElement) observer.observe(slot.parentElement);
    window.addEventListener('resize', place);
    place();
    return () => { cancelled = true; observer.disconnect(); window.removeEventListener('resize', place); };
  }, [showing, visible, page, !!failed, occluded, tab.id, device, customW, finding, full]);

  // A local server that is not up yet: keep knocking while its tab is in front.
  React.useEffect(() => {
    if (!visible || k.kind !== 'local' || !failed || failed.code !== ERR_CONNECTION_REFUSED) return undefined;
    const timer = setTimeout(() => quiet(api.browserCommand(tab.id, 'reload')), RETRY_MS);
    return () => clearTimeout(timer);
  }, [visible, k.kind, failed, tab.id]);

  // A preview's first page: the wait starts when its tab is in front, a clock runs while it lasts ("Waking…" from the
  // click, Couldn't load after a minute), and a failed load is tried again every few seconds, never over one still on its way.
  const drawn = !!(web && web.drawn);
  React.useEffect(() => {
    if (previewId && !drawn && !waitSince) setWaits((current) => ({ ...current, [tab.id]: Date.now() }));
  }, [previewId, drawn, waitSince, tab.id]);
  const ticking = !!previewId && !drawn && !!waitSince && wait !== 'failed' && visible;
  React.useEffect(() => {
    if (!ticking) return undefined;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(timer);
  }, [ticking]);
  React.useEffect(() => {
    if (!visible || wait !== 'waking' || !failed || (web && web.loading)) return undefined;
    const timer = setTimeout(() => quiet(api.browserCommand(tab.id, 'reload')), WAKE_RETRY_MS);
    return () => clearTimeout(timer);
  }, [visible, wait, failed, web && web.loading, tab.id]); // eslint-disable-line react-hooks/exhaustive-deps
  // Retry from Couldn't load: the wait starts over and the page is asked for again.
  const retryPreview = () => {
    setWaits((current) => ({ ...current, [tab.id]: Date.now() }));
    setNow(Date.now());
    const target = (failed && failed.url) || (web && web.url) || tab.url;
    if (target && !/^about:/i.test(target)) load(tab.id, target);
  };

  // Back and forward are the page's own history; from a pdf, the page that led to it, and forward from there is the pdf again.
  const canBack = pdf ? pdf.under !== 'about:blank' || !!(web && web.url) : page ? !!(web && web.canGoBack) : !!(web && web.url);
  const canForward = !pdf && (!!tab.pdfForward || (page && !!(web && web.canGoForward)));
  const back = () => {
    if (!canBack) return;
    if (pdf) update(tab.id, (t) => ({ ...t, pdf: null, pdfForward: t.pdf, url: t.pdf.under !== 'about:blank' ? t.pdf.under : (t.web && t.web.url) || 'about:blank' }));
    else if (page) quiet(api.browserCommand(tab.id, 'back'));
    else update(tab.id, (t) => ({ ...t, file: null, url: t.web.url }));
  };
  const forward = () => {
    if (!canForward) return;
    if (tab.pdfForward) update(tab.id, (t) => ({ ...t, pdf: t.pdfForward, pdfForward: null }));
    else quiet(api.browserCommand(tab.id, 'forward'));
  };
  const loading = page && !!(web && web.loading) && !failed;
  const reload = () => {
    if (pdf) { if (pdf.rowId && tab.row) showRow(tab.id, tab.row); else if (!pdf.loading && WEB_URL.test(pdf.url)) load(tab.id, pdf.url); else if (DISK_URL.test(pdf.url)) readPath(tab.id, stripScheme(pdf.url), null); }
    else if (page) quiet(api.browserCommand(tab.id, loading ? 'stop' : 'reload'));
    else if (tab.file && tab.file.path) readPath(tab.id, tab.file.path, tab.item);
  };

  /* ------------------------------------------------------------------------------------------ the address list */

  const query = typing && draft !== shownDraft ? draft.trim() : '';
  React.useEffect(() => {
    if (!query || !looksLikePlace(query)) { setFound(null); return undefined; }
    let live = true;
    const timer = setTimeout(() => {
      api.lookupLibraryItem(query).then((answer) => { if (live) setFound({ input: query, row: answer.row || null }); }).catch(() => { if (live) setFound(null); });
    }, 120);
    return () => { live = false; clearTimeout(timer); };
  }, [query]);
  const rows = React.useMemo(
    () => (typing ? stageRows({ query, library: library || [], inRail: inRail || (() => false), found: found && found.input === query ? found : undefined }) : []),
    [typing, query, library, inRail, found],
  );
  React.useEffect(() => { setPick(0); }, [query]);
  const leaveAddress = () => { setTyping(false); if (addressRef.current) addressRef.current.blur(); };
  const choose = (r) => {
    if (!r) return;
    if (r.kind === 'disk') { void chooseFiles(); return; }
    leaveAddress();
    if (r.kind === 'item') { openRow(r.row); return; }
    update(tab.id, noSections); // somewhere else: not the paper the guide's sections are in
    void navigate(tab.id, r.input); // a place goes there; words are a web search (model/address.js kindOf)
  };
  // Enter takes the row picked with the arrows; with nothing typed and nothing picked it goes to the address again (a reload).
  const arrowed = React.useRef(false);
  React.useEffect(() => { arrowed.current = false; }, [query, typing]);
  const onAddressKey = (event) => {
    if (event.key === 'ArrowDown') { event.preventDefault(); arrowed.current = true; setPick((i) => (i + 1) % Math.max(1, rows.length)); }
    else if (event.key === 'ArrowUp') { event.preventDefault(); arrowed.current = true; setPick((i) => (i - 1 + rows.length) % Math.max(1, rows.length)); }
    else if (event.key === 'Enter') {
      event.preventDefault();
      if (!query && !arrowed.current) { if (draft.trim()) reload(); leaveAddress(); return; }
      choose(rows[pick] || rows[0]);
    } else if (event.key === 'Escape') { setDraft(shownDraft); leaveAddress(); }
  };

  /* ---------------------------------------------------------------------------------------------- find */
  // One query for the pane; it follows the tab in front. A page is searched by Chromium (main: findInPage), a pdf by its
  // viewer, a file drawn here by its text. A new query starts over; Enter, ↓ and ⌘G step (1), ⇧Enter, ↑ and ⇧⌘G back (-1).
  const pdfReady = !!(pdf && pdf.bytes && pdf.marks !== undefined);
  // The answers being written for the pdf in front (the same list while nothing of it changed).
  const paperAsks = React.useMemo(() => (pdf ? (pendingAsks || []).filter((p) => samePdf(pdf, p)) : []), [pendingAsks, pdf && pdf.rowId, pdf && pdf.url]); // eslint-disable-line react-hooks/exhaustive-deps
  const runFind = (text, step) => {
    if (pdf) { setMatches(pdfReady && paperRef.current ? paperRef.current.find(text, step) : null); return; }
    if (view) {
      const box = fileRanges.current;
      if (!text.trim()) { clearRanges(); fileRanges.current = { ranges: [], active: -1, query: '' }; setMatches(null); return; }
      if (text !== box.query || step === 0) {
        const ranges = textRanges(viewRef.current, text);
        const keep = text === box.query ? Math.min(box.active, ranges.length - 1) : 0;
        fileRanges.current = { ranges, active: ranges.length ? Math.max(0, keep) : -1, query: text };
      } else if (box.ranges.length) {
        box.active = (box.active + step + box.ranges.length) % box.ranges.length;
      }
      const now = fileRanges.current;
      paintRanges(now.ranges, now.active, viewRef.current);
      setMatches({ matches: now.ranges.length, active: now.active + 1 });
      return;
    }
    if (!page || !web) { setMatches(null); return; }
    if (!text) { quiet(api.browserFind(tab.id, '')); setMatches(null); return; }
    quiet(api.browserFind(tab.id, text, { backward: step < 0 }));
  };
  React.useEffect(() => {
    if (!finding) return undefined;
    // A passage a link found just now is already found, in front and scrolled to: running the search again would not keep it.
    const landed = jumped.current && jumped.current.tabId === tab.id && jumped.current.text === findText;
    jumped.current = null;
    if (!landed) runFind(findText, 0);
    const id = tab.id, inPdf = !!pdf, inView = !!view;
    return () => {
      if (jumped.current && jumped.current.tabId === id) return; // the passage that replaces this search is painted already
      if (inPdf) {
        if (!paperRef.current) return;
        paperRef.current.stopFind();
        // A link's section went with its search, as ever, but for a guide's: that stays until the Sections menu changes it.
        if (landingFinds(tabsRef.current.find((t) => t.id === id))) paperRef.current.clearSection();
      }
      else if (inView) { clearRanges(); fileRanges.current = { ranges: [], active: -1, query: '' }; }
      else quiet(api.browserStopFind(id));
    };
  }, [finding, findText, tab.id, !!pdf, pdfReady, !!view, view && view.kind, page && !!web]); // eslint-disable-line react-hooks/exhaustive-deps
  React.useEffect(() => {
    if (!findFocus || !findRef.current) return;
    findRef.current.focus();
    findRef.current.select();
  }, [findFocus]);
  const openFind = () => { setFinding(true); setFindFocus((n) => n + 1); };
  const closeFind = () => { setFinding(false); setMatches(null); };

  // A link's passage, found once its tab is ready (DG-03). In a pdf PaperView has shown it as a section (`result`) by the
  // time it says so: the find card opens with the words, and the passage waits no longer. In a pdf with an @discover
  // guide's sections (2026-10-03) the find card stays as it was: the Sections menu says which one is shown. A page or a
  // drawn file is searched as ⌘F would, with no card (land, below).
  const clearPending = (id, text) => update(id, (t) => (t.pendingFind === text ? { ...t, pendingFind: null, pendingTo: null } : t));
  const landed = (id, text, result) => {
    const t = tabsRef.current.find((x) => x.id === id);
    update(id, (x) => landTab(x, text));
    if (t && !landingFinds(t)) return;
    const found = paperRef.current ? paperRef.current.find(text, 0, { fromStart: true }) : result; // find's match in front, as before
    const h = keys.current;
    if (!h.finding || h.findText !== text) jumped.current = { tabId: id, text };
    setFindText(text);
    setFinding(true);
    setMatches(found);
  };
  // The Sections menu: another section shown, or none (× takes the menu too).
  const sectionsOn = !!(pdf && tab.sections && tab.sections.length);
  const pickSection = (i) => {
    const section = tab.sections && tab.sections[i];
    if (!section) return;
    update(tab.id, (t) => ({ ...t, activeSection: i }));
    if (paperRef.current) paperRef.current.showSection(section.find, section.to);
  };
  const closeSections = () => {
    update(tab.id, noSections);
    if (paperRef.current) paperRef.current.clearSection();
  };
  // A page or a drawn file: the passage is found and scrolled to without the card (2026-10-03). Chromium keeps a page's
  // highlight until stopFindInPage and a file's stays painted until clearRanges, and only the card's closing does either.
  // With the card open already its query becomes the passage, as before; ⌘F later opens it with the last one typed.
  const land = (id, text) => {
    clearPending(id, text);
    const h = keys.current;
    if (!h.finding || h.findText === text) runFind(text, 0);
    else setFindText(text);
  };
  React.useEffect(() => {
    const text = tab.pendingFind;
    if (!text || pdf || !visible) return;
    if (view) {
      if (view.kind === 'error') clearPending(tab.id, text);
      else if (view.kind !== 'loading') land(tab.id, text);
      return;
    }
    // A page that has loaded, at an address: one that turned into a pdf (a download) never commits one, and waits for the viewer.
    if (page && web && !web.loading && !failed && web.url && web.url !== 'about:blank') land(tab.id, text);
  }, [tab.id, tab.pendingFind, !!pdf, visible, view && view.kind, page, web && web.loading, web && web.url, !!failed]); // eslint-disable-line react-hooks/exhaustive-deps

  // ⌘T while the Stage shows and ⌘W from anywhere but the terminal, bringing the Stage forward; ⌘F while the Stage shows and has the keyboard
  // (its fields, a pdf, a page: main forwards those) or nothing else that takes typing does; ⌘G / ⇧⌘G while finding.
  keys.current = {
    tabId: tab.id,
    finding,
    findText,
    openInput,
    shortcut: (name, from) => {
      if (name === 'new-tab') { if (onShow) onShow(); newTab(); return; }
      if (name === 'close-tab') { if (onShow) onShow(); closeTab(from || tab.id); return; }
      if (typeof name === 'string' && /^tab-[1-9]$/.test(name)) { const t = tabs[Number(name.slice(4)) - 1]; if (t) select(t); return; } // ⌘1–9 pressed in a page
      if (!visible) return;
      if (name === 'find') { if (from || !editable(document.activeElement) || (rootRef.current && rootRef.current.contains(document.activeElement))) openFind(); }
      else if ((name === 'find-next' || name === 'find-previous') && finding) runFind(findText, name === 'find-next' ? 1 : -1);
    },
  };
  React.useEffect(() => {
    const onKey = (event) => {
      if (!event.metaKey || event.altKey || event.ctrlKey || event.defaultPrevented) return;
      const key = event.key.toLowerCase();
      const inside = rootRef.current && event.target && rootRef.current.contains(event.target);
      const take = () => { event.preventDefault(); event.stopPropagation(); };
      if ((key === 't' || key === 'w') && !event.shiftKey) {
        if (inTerminal(event.target)) return; // the terminal's own tabs
        if (key === 't' && !visible) return; // the Terminal shows: ⌘T opens a terminal there (TerminalPane, 2026-09-25)
        take();
        keys.current.shortcut(key === 't' ? 'new-tab' : 'close-tab', null);
      } else if (!visible) {
        /* the rest only while the Stage shows */
      } else if (key === 'f' && !event.shiftKey && (inside || !editable(event.target))) { take(); keys.current.shortcut('find', null); }
      else if (key === 'g' && keys.current.finding) { take(); keys.current.shortcut(event.shiftKey ? 'find-previous' : 'find-next', null); }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [visible]);

  // A link in a markdown file opens here too.
  const onViewClick = (event) => {
    const link = event.target.closest && event.target.closest('a[data-stage-link]');
    if (!link) return;
    event.preventDefault();
    openInput(link.dataset.stageLink);
  };

  /* ------------------------------------------------------------------------------------------ tab cards */
  const enterTab = (event, t) => {
    clearTimeout(hoverTimer.current);
    if (t.id === tab.id) return;
    const r = event.currentTarget.getBoundingClientRect();
    const pane = rootRef.current ? rootRef.current.getBoundingClientRect() : { left: 0, right: window.innerWidth };
    const width = Math.max(160, Math.min(260, pane.right - pane.left - 16));
    const left = Math.max(pane.left + 8, Math.min(r.left + 4, pane.right - 8 - width));
    hoverTimer.current = setTimeout(() => { hoverWarm.current = true; setHover({ id: t.id, left: Math.round(left - r.left), width: Math.round(width) }); }, hoverWarm.current ? 60 : HOVER_MS);
  };
  const leaveTab = () => {
    clearTimeout(hoverTimer.current);
    setHover(null);
    clearTimeout(warmTimer.current);
    warmTimer.current = setTimeout(() => { hoverWarm.current = false; }, 400);
  };
  React.useEffect(() => () => { clearTimeout(hoverTimer.current); clearTimeout(warmTimer.current); }, []);

  // A tab given back and not shown yet goes by the title it was kept with, and the place it will open.
  const rowOf = (id) => (library || []).find((row) => row.id === id) || null;
  const titleOf = (t) => {
    if (t.restore) { const row = t.restore.item ? rowOf(t.restore.item) : null; return t.restore.title || (row ? row.name : stripScheme(t.restore.address || '')) || 'New tab'; }
    if (t.row) return t.row.name;
    if (t.pdf) return t.pdf.name;
    if (t.file && t.file.name) return t.file.name;
    if (t.url === 'about:blank') return 'New tab';
    return (isPage(kindOf(t.url)) && t.web && t.web.title) || stripScheme(t.url);
  };
  const keptPlace = (entry) => { const row = entry.item ? rowOf(entry.item) : null; return row ? row.url || row.path || row.folder_path : entry.address || ''; };
  const placeOf = (t) => (t.restore ? tabPlace(keptPlace(t.restore)) : t.url === 'about:blank' && !t.pdf && !t.file ? 'new tab' : tabPlace(t.pdf ? (t.pdf.input || t.pdf.url) : t.file && t.file.path ? t.file.path : (t.web && t.web.url) || t.url));

  const dev = DEVICES.find((d) => d.id === device);
  const width = device === 'custom' ? (Number(customW) || 390) : (dev ? dev.w : 0);
  const slotStyle = width ? { flex: 'none', width, height: '100%', background: '#fff', margin: '0 auto' } : { flex: 1, width: '100%', background: '#fff' };
  const menuW = Math.min(240, (window.innerWidth || 1200) - 16);
  const tabsFull = tabs.length >= MAX_TABS;
  const listOpen = typing && rows.length > 0;

  return (
    <div ref={rootRef} data-stage="1" data-browser="1" style={{ flex: 1, minHeight: 0, display: visible ? 'flex' : 'none', flexDirection: 'column', background: '#fff', overflow: 'hidden' }}>
      {/* The tabs: the one in front is white and runs into the address row below; the rest have no box. */}
      <div style={{ flex: 'none', position: 'relative', zIndex: 5, display: 'flex', alignItems: 'flex-end', height: 40, boxSizing: 'border-box', padding: '0 8px 0 10px', background: '#fafafa' }}>
        <div style={{ flex: '0 1 auto', minWidth: 0, display: 'flex', alignItems: 'flex-end', height: '100%' }}>
          {tabs.map((t, i) => {
            const on = t.id === tab.id;
            const sep = !on && tabs[i + 1] && tabs[i + 1].id !== tab.id;
            const isBlank = t.url === 'about:blank' && !t.pdf && !t.file && !t.restore;
            const title = titleOf(t);
            const glyph = <KindGlyph item={glyphItem(t, rowOf)} box={16} color={on ? '#4d4d4d' : '#8f8f8f'} />;
            const titleSpan = <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', whiteSpace: 'nowrap', WebkitMaskImage: 'linear-gradient(90deg,#000 calc(100% - 22px),transparent)', maskImage: 'linear-gradient(90deg,#000 calc(100% - 22px),transparent)', font: '400 12.5px/1.3 var(--font-sans)', color: isBlank ? '#8f8f8f' : on ? '#171717' : '#4d4d4d' }}>{title}</span>;
            const close = <button type="button" className="hov-x" onClick={(event) => { event.stopPropagation(); closeTab(t.id); }} onMouseDown={(event) => event.stopPropagation()} aria-label="Close tab" title="⌘W" style={{ flex: 'none', width: 20, height: 20, padding: 0, border: 0, borderRadius: '50%', background: 'transparent', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', font: '14px/1 var(--font-sans)', color: '#8f8f8f', transition: 'background 120ms' }}>×</button>;
            return (
              <div key={t.id} data-stage-tab={t.id} onMouseEnter={(event) => enterTab(event, t)} onMouseLeave={leaveTab} style={{ position: 'relative', flex: '0 1 220px', width: 220, minWidth: 44, height: 34, display: 'flex', alignItems: 'stretch' }}>
                {on ? (
                  <div onMouseDown={(event) => { if (event.button === 0) select(t); }} style={{ position: 'relative', flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: 8, boxSizing: 'border-box', padding: '0 6px 0 12px', background: '#fff', borderRadius: '10px 10px 0 0', cursor: 'default' }}>
                    <span aria-hidden="true" style={{ position: 'absolute', left: -10, bottom: 0, width: 10, height: 10, background: 'radial-gradient(circle at 0 0, transparent 9.5px, #fff 10px)' }} />
                    <span aria-hidden="true" style={{ position: 'absolute', right: -10, bottom: 0, width: 10, height: 10, background: 'radial-gradient(circle at 100% 0, transparent 9.5px, #fff 10px)' }} />
                    {glyph}{titleSpan}{close}
                  </div>
                ) : (
                  <div className="hov-tab" onMouseDown={(event) => { if (event.button === 0) select(t); }} style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: 8, boxSizing: 'border-box', margin: '0 2px 4px', padding: '0 4px 0 10px', borderRadius: 8, background: 'transparent', cursor: 'default', transition: 'background 120ms' }}>
                    {glyph}{titleSpan}{close}
                  </div>
                )}
                {sep && <span aria-hidden="true" style={{ position: 'absolute', right: 0, top: 9, width: 1, height: 16, background: '#c9c9c9' }} />}
                {hover && hover.id === t.id && !on && (
                  <div data-overlay="1" style={{ position: 'absolute', left: hover.left, top: 'calc(100% + 6px)', zIndex: 60, width: hover.width, boxSizing: 'border-box', padding: '10px 12px', background: '#fff', border: '1px solid #c9c9c9', borderRadius: 8, pointerEvents: 'none', animation: `rise 160ms ${EASE}` }}>
                    <div style={{ font: '500 13px/1.4 var(--font-sans)', color: '#171717', overflowWrap: 'anywhere', textWrap: 'pretty' }}>{title}</div>
                    <div style={{ marginTop: 3, font: '12px/1.4 var(--font-sans)', color: '#8f8f8f', overflowWrap: 'anywhere' }}>{placeOf(t)}</div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
        <button type="button" className="hov-tab-plus" onClick={newTab} disabled={tabsFull} aria-label="New tab" title={tabsFull ? '15 tabs is the most — close one first' : '⌘T'} style={{ flex: 'none', opacity: tabsFull ? 0.4 : 1, alignSelf: 'center', width: 28, height: 28, margin: '2px 0 0 6px', padding: 0, border: 0, borderRadius: '50%', background: 'transparent', cursor: tabsFull ? 'default' : 'pointer', font: '18px/1 var(--font-sans)', color: '#4d4d4d', transition: 'background 120ms' }}>+</button>
        {onFull && (
          <button type="button" className="hov-wash2" onClick={() => { setHover(null); onFull(); }} aria-label={full ? 'Exit full screen' : 'Full screen'} title={full ? 'Exit full screen' : 'Full screen'} data-stage-full={full ? '1' : '0'} style={{ flex: 'none', alignSelf: 'center', width: 28, height: 28, margin: '2px 0 0 auto', padding: 0, border: 0, borderRadius: 6, background: 'transparent', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'background 120ms' }}>{full ? <Collapse /> : <Expand />}</button>
        )}
      </div>

      <div style={{ position: 'relative', flex: 'none', display: 'flex', alignItems: 'center', gap: 6, padding: '8px 10px', borderBottom: '1px solid #eaeaea' }}>
        <button type="button" className="hov-wash" onClick={back} aria-label="Back" style={{ ...ICON_BUTTON, color: canBack ? '#171717' : '#c9c9c9' }}>←</button>
        <button type="button" className="hov-wash" onClick={forward} aria-label="Forward" style={{ ...ICON_BUTTON, color: canForward ? '#171717' : '#c9c9c9' }}>→</button>
        <button type="button" className="hov-wash" onClick={reload} aria-label={loading ? 'Stop' : 'Reload'} style={{ ...ICON_BUTTON, color: '#4d4d4d' }}>{loading ? '×' : '↻'}</button>
        <div style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: 8, height: 30, boxSizing: 'border-box', padding: saveState && !typing ? '0 3px 0 10px' : '0 10px', border: `1px solid ${typing ? '#c9c9c9' : 'transparent'}`, borderRadius: 8, background: '#fafafa', transition: 'border-color 120ms' }}>
          <KindGlyph item={glyphItem(tab, rowOf)} box={14} color="#8f8f8f" />
          <input
            ref={addressRef}
            value={draft}
            onChange={(event) => { setDraft(event.target.value); setTyping(true); }}
            onFocus={(event) => { const el = event.target; setTyping(true); setTimeout(() => { try { el.select(); } catch { /* gone */ } }, 0); }}
            onBlur={() => { setTyping(false); if (document.activeElement !== addressRef.current) setDraft((d) => (d.trim() ? d : shownDraft)); }}
            onKeyDown={onAddressKey}
            spellCheck={false}
            aria-label="Open on stage"
            style={{ flex: 1, minWidth: 0, padding: 0, border: 0, outline: 'none', background: 'transparent', font: '400 13px/1.4 var(--font-sans)', color: '#171717', textAlign: 'left' }}
          />
          {saveState && !typing && (
            <button
              ref={saveButton}
              type="button"
              data-page-save={saveState}
              className={saveState === 'here' ? undefined : 'hov-ink'}
              onClick={onSaveClick}
              aria-expanded={saving}
              style={{ flex: 'none', height: 24, padding: '0 8px', border: 0, borderRadius: 5, background: saving ? '#eaeaea' : 'transparent', cursor: saveState === 'here' ? 'default' : 'pointer', font: '500 12px/1 var(--font-sans)', color: saveState === 'here' ? '#8f8f8f' : saving ? '#171717' : '#4d4d4d', whiteSpace: 'nowrap', transition: 'background 120ms, color 120ms' }}
            >{SAVE_LABEL[saveState]}</button>
          )}
        </div>
        {boxRemoved && boxRemoved.id === tab.id && (
          <div data-box-removed="1" role="status" style={BOX_TOAST} onMouseDown={(event) => event.preventDefault()}>
            <span>Box removed</span>
            <span style={{ color: '#8f8f8f' }}>·</span>
            <button type="button" data-box-undo="1" style={BOX_TOAST_UNDO} onClick={() => { const id = boxRemoved.id; clearTimeout(boxTimer.current); setBoxRemoved(null); quiet(api.browserBoxUndo(id)); }}>Undo</button>
          </div>
        )}
        {boxable && (
          <button type="button" className="hov-wash" data-stage-box={boxing === tab.id ? 'on' : 'off'} aria-pressed={boxing === tab.id} onClick={() => quiet(api.browserBox(tab.id))} aria-label="Box part of the page" title="Box part of the page (or hold ⌥ and drag)" style={{ ...ICON_BUTTON, display: 'flex', alignItems: 'center', justifyContent: 'center', background: boxing === tab.id ? '#f2f2f2' : 'transparent', color: boxing === tab.id ? '#0070f3' : '#4d4d4d' }}><BoxGlyph /></button>
        )}
        {saving && saveState === 'none' && <SaveCard key={pageInput} title={pageTitle || stripScheme(pageInput)} onSave={save.onSave} onClose={() => setSaving(false)} cardRef={saveCard} />}
        {sendingPdf && <SendToRemarkable key={sendingPdf.seq} name={sendingPdf.name} bytes={sendingPdf.bytes} rowId={sendingPdf.rowId} input={sendingPdf.input} onRow={(rowId) => adoptRow(sendingPdf.tabId, sendingPdf.pdfSeq, rowId)} onClose={() => setSendingPdf(null)} />}
        <div style={{ position: 'relative' }} ref={menuRef}>
          <button type="button" className="hov-wash" onClick={(event) => { const r = event.currentTarget.getBoundingClientRect(); setMenu(menu ? null : { x: r.right, y: r.bottom }); }} aria-label="More" style={{ ...ICON_BUTTON, background: menu ? '#f2f2f2' : 'transparent', font: '600 16px/1 var(--font-sans)', color: '#4d4d4d' }}>⋮</button>
          {menu && (
            <div data-overlay="1" style={{ position: 'fixed', left: clamp(menu.x - menuW, 8, (window.innerWidth || 1200) - menuW - 8), top: menu.y + 6, zIndex: 60, width: menuW, padding: 4, background: '#fff', border: '1px solid #eaeaea', borderRadius: 8, animation: `rise 160ms ${EASE}` }}>
              <div style={{ padding: '6px 10px', font: '500 9px/1 var(--font-sans)', letterSpacing: '1.6px', textTransform: 'uppercase', color: '#8f8f8f' }}>Device preset</div>
              {DEVICES.map((d) => (
                <div key={d.id} className="hov-wash" onClick={() => { setDevice(d.id); setMenu(null); }} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '7px 10px', borderRadius: 6, cursor: 'pointer' }}>
                  <span style={{ flex: 'none', width: 14, textAlign: 'center', font: '12px/1 var(--font-sans)', color: '#171717' }}>{device === d.id ? '✓' : ''}</span>
                  <span style={{ flex: 1, font: '13px/1.4 var(--font-sans)', color: '#171717' }}>{d.name}</span>
                  <span style={{ font: '11px/1 var(--font-mono)', color: '#8f8f8f' }}>{d.w ? `${d.w}×${d.h}` : ''}</span>
                </div>
              ))}
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', borderTop: '1px solid #eaeaea', marginTop: 4 }}>
                <span style={{ flex: 1, font: '13px/1.4 var(--font-sans)', color: '#171717' }}>Custom width</span>
                <input value={customW} onChange={(event) => { setCustomW(event.target.value.replace(/\D/g, '')); setDevice('custom'); }} inputMode="numeric" aria-label="Custom width" style={{ width: 64, padding: '4px 8px', border: '1px solid #eaeaea', borderRadius: 6, background: '#fafafa', font: '12px/1.4 var(--font-mono)', color: '#171717', textAlign: 'right' }} />
              </div>
              {((page && web) || (pdf && WEB_URL.test(pdf.url))) && (
                <div style={{ borderTop: '1px solid #eaeaea', marginTop: 4, paddingTop: 4 }}>
                  <div className="hov-wash" onClick={() => { quiet(api.openExternal(pdf ? pdf.url : web.url || tab.url)); setMenu(null); }} style={{ padding: '7px 10px 7px 34px', borderRadius: 6, cursor: 'pointer', font: '13px/1.4 var(--font-sans)', color: '#171717' }}>Open in default browser</div>
                  {page && <div className="hov-wash" onClick={() => { quiet(api.browserCommand(tab.id, 'devtools')); setMenu(null); }} style={{ padding: '7px 10px 7px 34px', borderRadius: 6, cursor: 'pointer', font: '13px/1.4 var(--font-sans)', color: '#171717' }}>Developer tools</div>}
                </div>
              )}
              {IS_MAC && pdf && pdf.bytes && !fromRemarkable(pdf, rowKinds) && (
                <div style={{ borderTop: '1px solid #eaeaea', marginTop: 4, paddingTop: 4 }}>
                  <div className="hov-wash" data-stage-send-remarkable="1" onClick={() => { setMenu(null); setSendingPdf({ name: pdf.name, bytes: pdf.bytes, rowId: pdf.rowId || null, input: pageInput || null, tabId: tab.id, pdfSeq: pdf.seq, seq: Date.now() }); }} style={{ padding: '7px 10px 7px 34px', borderRadius: 6, cursor: 'pointer', font: '13px/1.4 var(--font-sans)', color: '#171717' }}>Send to reMarkable</div>
                </div>
              )}
              {IS_MAC && (
                <div style={{ borderTop: '1px solid #eaeaea', marginTop: 4, paddingTop: 4 }}>
                  <div className="hov-wash" data-stage-import="1" onClick={() => { setMenu(null); setImporting(true); }} style={{ padding: '7px 10px 7px 34px', borderRadius: 6, cursor: 'pointer', font: '13px/1.4 var(--font-sans)', color: '#171717' }}>Import sign-ins…</div>
                </div>
              )}
            </div>
          )}
        </div>
        {listOpen && (
          <div data-overlay="1" data-stage-list="1" onMouseDown={(event) => event.preventDefault()} style={{ position: 'absolute', left: 92, right: 10, top: 44, zIndex: 40, maxHeight: 420, overflowY: 'auto', boxSizing: 'border-box', padding: 6, background: '#fff', border: '1px solid #c9c9c9', borderRadius: 8, boxShadow: '0 12px 32px rgba(0,0,0,.06)', animation: `rise 160ms ${EASE}` }}>
            {rows.map((r, i) => {
              const glyph = r.kind === 'item' ? <KindGlyph item={r.row} box={16} color="#4d4d4d" />
                : r.kind === 'search' ? <span className="glyph-fit" style={{ display: 'flex', width: 13, height: 13, margin: '0 1.5px', color: '#4d4d4d' }}><SEARCH /></span>
                  : r.kind === 'disk' ? <span className="glyph-fit" style={{ display: 'flex', width: 12, height: 12, margin: '0 2px', color: '#4d4d4d' }}><FOLDER /></span>
                    : <KindGlyph item={glyphItem({ url: kindOf(r.input).url || 'about:blank', file: /^[.~/]/.test(r.input) ? { path: r.input } : null })} box={16} color="#4d4d4d" />;
              const name = r.kind === 'item' ? r.row.name : r.kind === 'disk' ? 'Choose a file from your computer…' : r.input;
              return (
                <button key={r.key} type="button" data-stage-row={r.kind} onClick={() => choose(r)} onMouseMove={() => { arrowed.current = true; if (pick !== i) setPick(i); }} style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%', boxSizing: 'border-box', padding: '7px 10px', border: 0, borderRadius: 6, background: i === pick ? '#f2f2f2' : 'transparent', cursor: 'pointer', textAlign: 'left' }}>
                  <span style={{ flex: 'none', width: 16, height: 16, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{glyph}</span>
                  <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', font: '400 13px/1.4 var(--font-sans)', color: '#171717' }}>{name}</span>
                </button>
              );
            })}
          </div>
        )}
      </div>

      <div style={{ flex: 1, minHeight: 0, position: 'relative', display: 'flex', flexDirection: 'column', background: pdf ? '#fff' : '#fafafa' }}>
        {finding && <FindCard inputRef={findRef} text={findText} found={matches} onText={setFindText} onStep={(step) => runFind(findText, step)} onClose={closeFind} />}
        {sectionsOn && pdfReady && <SectionsMenu key={tab.id} sections={tab.sections} active={tab.activeSection} below={finding} onPick={pickSection} onClose={closeSections} />}
        {/* a page sits under a band while the find card is open: a native view would cover it */}
        {finding && page && <div style={{ flex: 'none', height: 54 }} />}

        {pdf && (
          pdfReady ? (
            <PaperView
              key={`${tab.id}:${pdf.seq}`}
              ref={paperRef}
              bytes={pdf.bytes}
              marks={pdf.marks}
              target={tab.pendingFind || null}
              targetTo={tab.pendingTo || null}
              initialSection={sectionsOn ? tab.sections[tab.activeSection] || null : null}
              view={pdf.view || null}
              onView={(view) => { const { seq } = pdf; update(tab.id, (t) => (t.pdf && t.pdf.seq === seq ? { ...t, pdf: { ...t.pdf, view } } : t)); }}
              onTarget={(text, result) => landed(tab.id, text, result)}
              onFind={(result) => { if (keys.current && keys.current.finding) setMatches(result); }}
              library={library}
              mentionItems={mentionItems}
              onMentionOpen={onMentionOpen}
              listFolder={listFolder}
              fileState={fileState}
              onOpenFile={onOpenFile}
              onOpenMention={(id) => { const row = (library || []).find((r) => r.id === id); if (row && onOpenItem) onOpenItem(row); }}
              pendingAsks={paperAsks}
              onAsk={onAsk ? (ask) => { void askFromPaper(pdf, ask); } : undefined}
              onStopAsk={onStopAsk}
              onDismissAsk={onDismissAsk}
              onContinueAsk={onContinueAsk ? (asked) => onContinueAsk({ ...asked, paper: { name: pdf.name || '', rowId: pdf.rowId || null, url: pdf.url || null } }) : undefined}
              onCopyText={onCopyText}
              onOpenLink={(href) => openInput(href, { newTab: true })}
              onMarksChange={(marks) => {
                const { seq, url, rowId } = pdf, where = pdfWhere(pdf);
                // Every other tab holding this pdf takes the ink as it is now: brought forward, it must not save what it read before.
                setTabs((current) => current.map((t) => {
                  const mine = t.id === tab.id ? !!t.pdf && t.pdf.seq === seq : !!t.pdf && t.pdf.marks !== undefined && samePdf(t.pdf, where);
                  return mine ? { ...t, pdf: { ...t.pdf, marks } } : t;
                }));
                (rowId ? api.writeAnnotations(rowId, marks) : api.writePageAnnotations(url, marks)).catch((error) => { if (onError) onError(error); });
              }}
            />
          ) : (
            pdf.error ? <Plain title={stripScheme(pdf.input || pdf.url)} detail={pdf.error} error /> : <Plain title="" detail="" />
          )
        )}
        {view && (
          <div ref={viewRef} onClick={onViewClick} data-stage-view={view.kind} style={{ flex: 1, minHeight: 0, overflow: 'auto', background: view.kind === 'md' || view.kind === 'text' ? '#fff' : '#fafafa' }}>
            {view.kind === 'md' && <MarkdownView text={view.text} />}
            {view.kind === 'table' && <TableView text={view.text} delimiter={view.delimiter} truncated={view.truncated} />}
            {view.kind === 'text' && <pre style={{ margin: 0, padding: '14px 16px', font: '12.5px/1.7 var(--font-mono)', color: '#171717', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{view.text}</pre>}
            {view.kind === 'image' && <ImageView file={view} />}
            {view.kind === 'folder' && <Plain title={view.name} detail={view.path} />}
            {view.kind === 'unsupported' && <Plain title={view.name} detail={view.path} />}
            {view.kind === 'error' && <Plain title={view.path} detail={view.message} error />}
          </div>
        )}
        {blank && (
          <div style={{ flex: 1, minHeight: 0, boxSizing: 'border-box', padding: 24, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 8, textAlign: 'center' }}>
            <div style={{ marginTop: -48, font: '500 34px/1 var(--font-sans)', letterSpacing: '-0.4px', color: '#171717', userSelect: 'none' }}>Engelbart</div>
            <button type="button" className="hov-bd2" onClick={chooseFiles} style={{ marginTop: 22, height: 32, padding: '0 14px', border: '1px solid #eaeaea', borderRadius: 8, background: '#fff', cursor: 'pointer', font: '500 13px/1 var(--font-sans)', color: '#171717', transition: 'border-color 120ms' }}>Choose a file…</button>
          </div>
        )}
        {page && (
          <div style={{ flex: 1, minHeight: 0, display: 'flex', justifyContent: 'center', background: '#f2f2f2', overflow: 'hidden' }}>
            <div ref={slotRef} data-browser-slot="1" style={{ ...slotStyle, position: 'relative', minHeight: 0, overflow: 'hidden' }}>
              {wait ? (
                <div data-stage-wait={wait} style={{ position: 'absolute', inset: 0, background: '#fafafa' }}>
                  {wait === 'waking' ? (
                    <Plain title={previewName(previewRow) ? `Waking ${previewName(previewRow)}'s sandbox…` : 'Waking the sandbox…'} detail="It was asleep — this can take a few seconds." prose />
                  ) : (
                    <Plain title={previewName(previewRow) ? `Couldn't load ${previewName(previewRow)}'s preview` : "Couldn't load the preview"} detail="The sandbox didn't answer. It may still be starting, or its app has stopped." prose>
                      <PlainAction primary onClick={retryPreview}>Retry</PlainAction>
                      {previewRow && sandboxes.openBuild && <PlainAction onClick={(event) => sandboxes.openBuild(previewRow, event.currentTarget)}>Build details</PlainAction>}
                    </Plain>
                  )}
                </div>
              ) : failed ? (
                <div style={{ position: 'absolute', inset: 0, background: '#fafafa' }}>
                  <Plain title={stripScheme(failed.url || tab.url)} detail={failed.description || `error ${failed.code}`}>
                    <PlainAction onClick={() => quiet(api.browserCommand(tab.id, 'reload'))}>Retry</PlainAction>
                  </Plain>
                </div>
              ) : snapshot && !showing ? (
                <img src={snapshot} alt="" draggable={false} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', objectPosition: 'left top', userSelect: 'none' }} />
              ) : null}
            </div>
          </div>
        )}
        {!pdf && !view && !page && k.kind === 'sandbox' && <Plain title={k.name} detail="" />}
      </div>
      {logins[0] && createPortal(
        <LoginPrompt
          key={logins[0].requestId}
          request={logins[0]}
          onAnswer={(credentials) => { quiet(api.browserLoginReply(logins[0].requestId, credentials)); setLogins((current) => current.slice(1)); }}
        />,
        document.body,
      )}
      {importing && <ImportSignins onClose={() => setImporting(false)} onOpenSite={(url) => openInput(url)} />}
    </div>
  );
});

export default Stage;
