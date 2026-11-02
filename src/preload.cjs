'use strict';

const { contextBridge, ipcRenderer, webUtils } = require('electron');

function subscribe(channel, callback) {
  if (typeof callback !== 'function') throw new TypeError('Listener must be a function');
  const listener = (_event, payload) => callback(payload);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

// The window has no title bar on macOS: styles.css moves the header off the traffic lights by these two marks.
function markWindow() {
  const root = document.documentElement;
  if (!root) return;
  root.dataset.platform = process.platform;
}
if (document.documentElement) markWindow(); else document.addEventListener('DOMContentLoaded', markWindow, { once: true });
ipcRenderer.on('window:fullscreen', (_event, on) => { if (document.documentElement) document.documentElement.toggleAttribute('data-fullscreen', !!on); });
// Whether Engelbart's window has the keyboard, as main says (window:focus). Not the document's own focus: a page on the
// Stage taking the keyboard blurs this document, not the window.
let windowFocused = false;
ipcRenderer.on('window:focus', (_event, on) => { windowFocused = !!on; });

// Wider resize edges: App.jsx's strips report press / move / release; main reads the cursor itself.
contextBridge.exposeInMainWorld('engelbartWindow', Object.freeze({
  edgeResize: (phase, edge) => ipcRenderer.send('window:edge-resize', String(phase), edge == null ? null : String(edge)),
}));

// Experimental Terminal bridge, v1 — unchanged contract (see docs in that repo).
const terminalAPI = Object.freeze({
  bootstrap: () => ipcRenderer.invoke('terminal:bootstrap'),
  providers: () => ipcRenderer.invoke('terminal:providers'),
  createSession: (request) => ipcRenderer.invoke('terminal:create', request),
  writeSession: (id, data) => ipcRenderer.invoke('terminal:write', id, data),
  resizeSession: (id, cols, rows) => ipcRenderer.invoke('terminal:resize', id, cols, rows),
  closeSession: (id) => ipcRenderer.invoke('terminal:close', id),
  acknowledge: (id, sequence) => ipcRenderer.send('terminal:acknowledge', id, sequence),
  pickDirectory: (current) => ipcRenderer.invoke('terminal:pick-directory', current),
  saveSettings: (settings) => ipcRenderer.invoke('terminal:save-settings', settings),
  openExternal: (url) => ipcRenderer.invoke('terminal:open-external', url),
  onData: (callback) => subscribe('terminal:data', callback),
  onExit: (callback) => subscribe('terminal:exit', callback),
  onMenu: (callback) => subscribe('terminal:menu', callback),
});

const invoke = (channel) => (...args) => ipcRenderer.invoke(`engelbart:${channel}`, ...args);

const engelbartAPI = Object.freeze({
  config: invoke('config'),
  setTestMode: invoke('set-test-mode'),
  resetTestData: invoke('reset-test-data'),
  lastOpen: invoke('last-open'),
  setLastOpen: invoke('set-last-open'),
  views: invoke('views'),
  setView: invoke('set-view'),
  stage: invoke('stage'),
  setStage: invoke('set-stage'),
  nav: invoke('nav'),
  recordEdit: invoke('record-edit'),
  seenAgents: invoke('seen-agents'),
  onNav: (callback) => subscribe('engelbart:nav', callback),
  // the sidebar's Starred: a project's starred library ids, and every change of them ({ projectId, ids })
  starred: invoke('starred'),
  setStarred: invoke('set-starred'),
  onStarred: (callback) => subscribe('engelbart:starred', callback),
  // the library changed behind the screen's back (a pdf saved as a link became a saved pdf: store/web-pdfs.cjs; another
  // window added, renamed or removed a row)
  onLibraryChanged: (callback) => subscribe('engelbart:library-changed', callback),
  // Several windows (2026-10-03, src/main/windows.cjs). Where this window opens ({ projectId, workspaceId }, { home: true },
  // or null: where the app was last), and where it has gone (projectId null on the projects screen).
  windowTarget: () => ipcRenderer.invoke('window:target'),
  reportPlace: (place) => ipcRenderer.send('window:navigated', place && typeof place === 'object' ? { projectId: place.projectId || null, workspaceId: place.workspaceId || null } : null),
  // What another window saved: a document ({ projectId, key, text, revision }, key `ws:<id>` or `note:<id>`), a project's
  // tree ({ projectId }), or the data root it switched to ({ config, fresh }).
  onDocChanged: (callback) => subscribe('doc:changed', callback),
  onProjectChanged: (callback) => subscribe('engelbart:project-changed', callback),
  onDataRootChanged: (callback) => subscribe('engelbart:data-root-changed', callback),
  // GitHub: the device-flow sign-in (status { configured, connected, login, pending: { userCode, verificationUri }, error, installUrl }) and the App's repositories.
  githubStatus: invoke('github-status'),
  githubConnect: invoke('github-connect'),
  githubCancel: invoke('github-cancel'),
  githubDisconnect: invoke('github-disconnect'),
  githubRepos: invoke('github-repos'),
  githubOpen: invoke('github-open'),
  onGithub: (callback) => subscribe('engelbart:github', callback),
  // Zotero (MATH-65): the browser sign-in through the broker (status { configured, connected, username, userID, persisted,
  // pending: { kind, expiresAt }, error }). The API key stays in main.
  zoteroStatus: invoke('zotero-status'),
  zoteroConnect: invoke('zotero-connect'),
  zoteroCancel: invoke('zotero-cancel'),
  zoteroDisconnect: invoke('zotero-disconnect'),
  // The library (MATH-65 build 2): the status's `sync` { state, items, syncedAt, error } is the mirror's. zoteroSync()
  // starts a sync; zoteroList(rel) a level of it for the @ menu (collections by name, then items); zoteroOpen(key) what a
  // mentioned item opens: { path, source } a pdf for the paper viewer, { url, external } a page for the default browser, or { error }.
  // Build 5: the status's `sync` also has { groups, problems }; zoteroList('') is My Library and each group; an item's key
  // here and on the channels below is its ref, `g<groupID>:<key>` for a group's.
  zoteroSync: invoke('zotero-sync'),
  zoteroList: invoke('zotero-list'),
  zoteroOpen: invoke('zotero-open'),
  onZotero: (callback) => subscribe('engelbart:zotero', callback),
  // Build 3: { key, finding } as a free copy of an item is looked for (the chip says "Finding a free copy…") and after.
  onZoteroFinding: (callback) => subscribe('engelbart:zotero-finding', callback),
  // Build 4: the items whose pdf is waited for in the Downloads folder (a chip opened the paper in the browser): their
  // keys now, then { key, waiting } on each change; { key, path } once the download was the paper, to open; and
  // zoteroAttach(key, path) to make a pdf dropped on a chip the item's ({ path, source } or { error }).
  zoteroWaiting: invoke('zotero-waiting'),
  onZoteroWaiting: (callback) => subscribe('engelbart:zotero-waiting', callback),
  onZoteroDownloaded: (callback) => subscribe('engelbart:zotero-downloaded', callback),
  zoteroAttach: invoke('zotero-attach'),
  // reMarkable (2026-10-31): the reMarkable app's notebooks as a library folder (src/main/remarkable/sync.cjs). Status
  // { connected, state, documents, syncedAt, error, code, problems, library }; remarkableHelp('app' | 'privacy') opens
  // the reMarkable app's download page or Privacy & Security.
  remarkableStatus: invoke('remarkable-status'),
  remarkableConnect: invoke('remarkable-connect'),
  remarkableDisconnect: invoke('remarkable-disconnect'),
  remarkableSync: invoke('remarkable-sync'),
  remarkableHelp: invoke('remarkable-help'),
  onRemarkable: (callback) => subscribe('engelbart:remarkable', callback),
  // Send to reMarkable: remarkableSend(name, bytes, rowId) → { state: 'sent' | 'drop' | 'given', name, file, since } or { error };
  // after a 'drop', remarkableDrag(file) on the chip's dragstart, and remarkableAwaitDrop({ name, since }).
  remarkableSend: invoke('remarkable-send'),
  remarkableAwaitDrop: invoke('remarkable-await-drop'),
  remarkableCancelDrop: invoke('remarkable-cancel-drop'),
  remarkableDrag: (file) => ipcRenderer.send('remarkable:drag', String(file)),
  // ⌘J pressed while a Browser page has the keyboard (src/main/browser/views.cjs); the app's own pages see the key themselves.
  onNextWorkspace: (callback) => subscribe('engelbart:next-workspace', callback),
  listProjects: invoke('list-projects'),
  createProject: invoke('create-project'),
  createProjectWithWelcome: invoke('create-project-with-welcome'),
  // Onboarding (src/main/store/onboarding.cjs).
  instructions: invoke('instructions'),
  setInstructions: invoke('set-instructions'),
  freeFolder: invoke('free-folder'),
  checkFolder: invoke('check-folder'),
  startProject: invoke('start-project'),
  discardLibraryItem: invoke('discard-library-item'),
  // Connect your library (src/main/connect; onboarding and a one-time popup, in every library): connectStart(choices) → the
  // session's snapshot, then every change of it on onConnect. connectNeed(id, needId, 'open' | 'done' | 'skip'): a step an
  // agent handed the person. connectList(): the sessions the dock shows.
  connectDetect: invoke('connect-detect'),
  connectProviders: invoke('connect-providers'),
  connectStart: invoke('connect-start'),
  connectAnswer: invoke('connect-answer'),
  connectAuthorize: invoke('connect-authorize'),
  connectChose: invoke('connect-chose'),
  connectCancelSignIn: invoke('connect-cancel-sign-in'),
  connectNeed: invoke('connect-need'),
  connectImport: invoke('connect-import'),
  connectStop: invoke('connect-stop'),
  connectStopJob: invoke('connect-stop-job'),
  connectProvider: invoke('connect-provider'),
  connectRetryMemory: invoke('connect-retry-memory'),
  connectMinimize: invoke('connect-minimize'),
  connectDismiss: invoke('connect-dismiss'),
  connectState: invoke('connect-state'),
  connectList: invoke('connect-list'),
  connectNotesPermission: invoke('connect-notes-permission'),
  connectConnectors: invoke('connect-connectors'),
  connectConnectorSignIn: invoke('connect-connector-sign-in'),
  connectConnectorCancel: invoke('connect-connector-cancel'),
  connectOffer: invoke('connect-offer'),
  connectOfferSeen: invoke('connect-offer-seen'),
  connectMemory: invoke('connect-memory'),
  onConnect: (callback) => subscribe('engelbart:connect', callback),
  onConnectors: (callback) => subscribe('engelbart:connectors', callback),
  renameProject: invoke('rename-project'),
  // Delete on the all-projects screen: into the trash for a week; Recently deleted lists it (and purges older ones), Restore brings it back.
  trashProject: invoke('trash-project'),
  restoreProject: invoke('restore-project'),
  trashedProjects: invoke('trashed-projects'),
  loadProject: invoke('load-project'),
  setProjectDirectory: invoke('set-project-directory'),
  createWorkspace: invoke('create-workspace'),
  renameWorkspace: invoke('rename-workspace'),
  trashWorkspace: invoke('trash-workspace'),
  restoreWorkspace: invoke('restore-workspace'),
  setWorkspaceContext: invoke('set-workspace-context'),
  saveImage: invoke('save-image'),
  readImage: invoke('read-image'),
  createNote: invoke('create-note'),
  renameNote: invoke('rename-note'),
  readDoc: invoke('read-doc'),
  writeDoc: invoke('write-doc'),
  copyDoc: invoke('copy-doc'),
  askBart: invoke('ask-bart'),
  stopBart: invoke('stop-bart'),
  bartModels: invoke('bart-models'),
  // Settings › Intelligence (src/main/bart/settings.cjs): { models, choices, usable, offered, cli }; a save of the defaults
  // ({ provider, buildProvider, bart, brainstorm, discover, build }) and "Use default" ('bart' | 'build' | 'quick') answer
  // the same, and every window hears onModelsChanged after either.
  settingsModels: invoke('settings-models'),
  saveSettingsModels: invoke('save-settings-models'),
  clearModelChoice: invoke('clear-model-choice'),
  onModelsChanged: (callback) => subscribe('engelbart:models-changed', callback),
  copyText: invoke('copy-text'),
  onBartProgress: (callback) => subscribe('engelbart:bart-progress', callback),
  // @bart from a highlight's note (MATH-27): the ones this window asked that are still running (for after ⌘R), and how each
  // ended, told to every window: { askId, markId, page, rowId | url, and entry (the answer, already on its mark) | stopped | failed and lines }.
  runningPaperAsks: invoke('running-paper-asks'),
  onPaperAskDone: (callback) => subscribe('engelbart:paper-ask-done', callback),
  // Build (src/main/build): a workspace's coding agent in a worktree of its own. Every change of one arrives on onBuild as
  // its record; onBuildProgress carries what a running turn is doing ({ projectId, id, activity, log, lines }).
  buildModels: invoke('build-models'), // ('quick' for a post-it's Build)
  rememberModelChoice: invoke('remember-model-choice'), // ('build' | 'quick', { provider, model, effort })
  // Where a Build works: the default repo (a folder named after the project, in the project folder), the project folder,
  // or a library repository ({ kind, id }); a GitHub one is cloned into repos/<name> first (buildClone).
  buildTargets: invoke('build-targets'),
  buildSetDefault: invoke('build-set-default'),
  buildPreflight: invoke('build-preflight'),
  buildInit: invoke('build-init'),
  buildClone: invoke('build-clone'),
  buildStart: invoke('build-start'),
  buildList: invoke('build-list'),
  buildGet: invoke('build-get'),
  buildReply: invoke('build-reply'),
  buildStop: invoke('build-stop'),
  buildResume: invoke('build-resume'),
  buildReview: invoke('build-review'),
  buildAccept: invoke('build-accept'),
  buildFix: invoke('build-fix'),
  buildDiscard: invoke('build-discard'),
  buildPromote: invoke('build-promote'),
  onBuild: (callback) => subscribe('engelbart:build', callback),
  onBuildProgress: (callback) => subscribe('engelbart:build-progress', callback),
  // What a Build has changed since it started, as its worktree stands: after each thing a turn does, and when it ends
  // ({ projectId, id, files, patch, truncated, running }).
  onBuildDiff: (callback) => subscribe('engelbart:build-diff', callback),
  // A runnable its run step got running ({ projectId, id, kind: 'ui' | 'app' | 'terminal', name, url?, session? }):
  // a UI opens in the Stage, a terminal program's session in the terminal.
  onBuildRun: (callback) => subscribe('engelbart:build-run', callback),
  buildRunShow: invoke('build-run-show'),
  buildRunStop: invoke('build-run-stop'),
  buildRunStopRunnable: invoke('build-run-stop-runnable'), // (projectId, id, name | null): an accepted Build's runnable, or all
  // A post-it's Build button asks the window for its Build popup, with the card's text, and where the card and the
  // button are ({ projectId, postItId, text, card, button }, CSS px of the window).
  onBuildQuick: (callback) => subscribe('engelbart:build-quick', callback),
  // A click on a post-it's quick-task state: that task, beside the card ({ projectId, id, postItId, card, button }).
  onBuildQuickOpen: (callback) => subscribe('engelbart:build-quick-open', callback),
  // Clear and the archived versions of a workspace (src/main/store/archive.cjs).
  clearWorkspace: invoke('clear-workspace'),
  restoreArchive: invoke('restore-archive'),
  readArchive: invoke('read-archive'),
  readTextFile: invoke('read-text-file'),
  resolvePageFile: invoke('resolve-page-file'),
  stageFile: invoke('stage-file'),
  library: invoke('library'),
  projectsForLibraryItem: invoke('projects-for-library-item'),
  libraryForProject: invoke('library-for-project'),
  libraryBodies: invoke('library-bodies'),
  addLibraryItem: invoke('add-library-item'),
  addLibraryPdf: invoke('add-library-pdf'),
  // The Stage's Save of a web page (MATH-17): the tab's page kept as a copy with its address. (tabId, address, { name })
  addLibraryPage: invoke('add-library-page'),
  // Dragged in (MATH-19): bytes without a path ({ mime, name, url }), and a link, kept as a copy when it is a picture or a pdf.
  addLibraryFile: invoke('add-library-file'),
  addLibraryUrl: invoke('add-library-url'),
  lookupLibraryItem: invoke('lookup-library-item'),
  pickLibraryPaths: invoke('pick-library-paths'),
  linkToWorkspace: invoke('link-to-workspace'),
  unlinkFromWorkspace: invoke('unlink-from-workspace'),
  // E2B previews of saved GitHub repositories (src/main/sandbox). Adding or linking one starts it, and the answer carries
  // `sandbox_error` when it could not start. onSandboxProgress: { dataRoot, run, message, notification? } per change.
  sandboxRuns: invoke('sandbox-runs'),
  ensureSandboxes: invoke('sandbox-ensure'),
  startSandbox: invoke('sandbox-start'),
  stopSandbox: invoke('sandbox-stop'),
  sandboxEnvironment: invoke('sandbox-environment'),
  saveSandboxEnvironment: invoke('sandbox-save-environment'),
  restartSandbox: invoke('sandbox-restart'),
  // A preview in front of a focused window is in use: its sandbox sleeps 10 minutes after the last of these (library id).
  touchSandbox: invoke('sandbox-touch'),
  // A shell in a ready repository's sandbox (library id): its session's snapshot, the one already open if there is one.
  // The pane adopts it (terminal/sessions.js adoptSession).
  sandboxTerminal: invoke('sandbox-terminal'),
  windowFocused: () => windowFocused,
  onWindowFocus: (callback) => subscribe('window:focus', callback),
  onSandboxProgress: (callback) => subscribe('engelbart:sandbox-progress', callback),
  previewLibraryItem: invoke('preview-library-item'),
  // A library folder's files (MATH-22): listFolder(id, rel) one level for the @ menu; folderFile(id, rel) a mentioned file,
  // with its absolute path and whether it is there; folderFiles([{ folderId, rel }]) whether each still is.
  listFolder: invoke('list-folder'),
  folderFile: invoke('folder-file'),
  folderFiles: invoke('folder-files'),
  // A file dropped on the window: where it is on disk (the renderer's File no longer says).
  pathForFile: (file) => { try { return webUtils.getPathForFile(file) || null; } catch { return null; } },
  renameLibraryItem: invoke('rename-library-item'),
  readLibraryFile: invoke('read-library-file'),
  readAnnotations: invoke('read-annotations'),
  writeAnnotations: invoke('write-annotations'),
  // Git, Claude Code and Codex (src/main/tools): what the last check saw, and the setup dialog's buttons.
  // Every change arrives on onTools as a whole snapshot; onToolsOpen is Engelbart ▸ Set Up Tools….
  tools: invoke('tools'),
  toolsCheck: invoke('tools-check'),
  toolsInstall: invoke('tools-install'),
  toolsUpdate: invoke('tools-update'),
  toolsSignIn: invoke('tools-sign-in'),
  toolsCancelSignIn: invoke('tools-cancel-sign-in'),
  toolsSignOut: invoke('tools-sign-out'),
  toolsSkip: invoke('tools-skip'),
  toolsAskAgain: invoke('tools-ask-again'),
  toolsSetUpdates: invoke('tools-set-updates'),
  onTools: (callback) => subscribe('engelbart:tools', callback),
  onToolsOpen: (callback) => subscribe('engelbart:tools-open', callback),
  // New versions (src/main/updates.cjs): { enabled, state, available, version, percent, dismissed }, then each change on
  // onUpdate; Restart to Update and Later from the banner (ui/UpdateBanner.jsx).
  updateState: invoke('update-state'),
  updateRestart: invoke('update-restart'),
  updateLater: invoke('update-later'),
  onUpdate: (callback) => subscribe('engelbart:update', callback),
  shellHistory: invoke('shell-history'),
  openExternal: invoke('open-external'),
  reveal: invoke('reveal'),
  // Browser pane: pages are native views in the main process (src/main/browser/views.cjs).
  browserOpen: (id, url) => ipcRenderer.invoke('browser:open', id, url),
  browserShow: (id, rect) => ipcRenderer.invoke('browser:show', id, rect),
  browserHide: (options) => ipcRenderer.invoke('browser:hide', options),
  browserCommand: (id, name) => ipcRenderer.invoke('browser:command', id, name),
  browserClose: (id) => ipcRenderer.invoke('browser:close', id),
  browserCloseAll: () => ipcRenderer.invoke('browser:close-all'),
  browserLoginReply: (requestId, credentials) => ipcRenderer.invoke('browser:login-reply', requestId, credentials),
  // Boxes on a page (MATH-70): the drawing layer over tab `id`, and the box it last removed put back. Main says when the
  // layer is up or gone ({ id, on }), when a box was removed ({ id, markId }) and when one came back.
  browserBox: (id) => ipcRenderer.invoke('browser:box', id),
  browserBoxUndo: (id) => ipcRenderer.invoke('browser:box-undo', id),
  onBrowserBoxing: (callback) => subscribe('browser:boxing', callback),
  onBrowserBoxRemoved: (callback) => subscribe('browser:box-removed', callback),
  onBrowserBoxRestored: (callback) => subscribe('browser:box-restored', callback),
  // A selected box's card (MATH-70 build 2): @bart asked from it ({ tab, markId, url, title, question, note, turns }) and
  // Stop pressed on it ({ askId }); what the Stage has running from boxes goes back for the card to show.
  onBrowserBoxAsk: (callback) => subscribe('browser:box-ask', callback),
  onBrowserBoxStop: (callback) => subscribe('browser:box-stop', callback),
  browserBoxAsks: (list) => ipcRenderer.invoke('browser:box-asks', list),
  onBrowserState: (callback) => subscribe('browser:state', callback),
  onBrowserClosed: (callback) => subscribe('browser:closed', callback),
  onBrowserLogin: (callback) => subscribe('browser:login', callback),
  onBrowserOpenTab: (callback) => subscribe('browser:open-tab', callback),
  onBrowserFocusAddress: (callback) => subscribe('browser:focus-address', callback),
  browserFind: (id, text, options) => ipcRenderer.invoke('browser:find', id, text, options),
  browserStopFind: (id) => ipcRenderer.invoke('browser:stop-find', id),
  onBrowserFound: (callback) => subscribe('browser:found', callback),
  // ⌘T / ⌘W from a page, and the Edit menu's Find items: { name, tab } (tab: the page that had the keyboard, else null).
  onBrowserShortcut: (callback) => subscribe('browser:shortcut', callback),
  // A tab's pdf: { id, url, name, under, loading | bytes | error } (src/main/browser/views.cjs).
  onBrowserPdf: (callback) => subscribe('browser:pdf', callback),
  // Import sign-ins from the person's browsers into the Stage (MATH-18, src/main/browser/import-cookies.cjs). Domains and
  // counts only cross here; cookie values never do. import-sources -> installed browsers and profiles; import-domains ->
  // [{ domain, count }] for a profile; import -> { imported, skipped, sessionOnly, checks }.
  browserImportSources: () => ipcRenderer.invoke('browser:import-sources'),
  browserImportDomains: (browser, profile) => ipcRenderer.invoke('browser:import-domains', browser, profile),
  browserImport: (request) => ipcRenderer.invoke('browser:import', request),
  readPageAnnotations: invoke('read-page-annotations'),
  writePageAnnotations: invoke('write-page-annotations'),
  postItsActivate: (projectId) => ipcRenderer.invoke('post-its:activate', projectId),
  postItsCreate: (projectId) => ipcRenderer.invoke('post-its:create', projectId),
  // The app's own open menus and dialogs (window CSS px): a card under one of them steps aside until it closes.
  postItsBlock: (rects) => ipcRenderer.invoke('post-its:block', rects),
  postItsLayout: () => ipcRenderer.invoke('post-its:layout'),
  // The sidebar's show/hide toggle: every card out of sight (true) or back (false); nothing is created or deleted.
  postItsHide: (hidden) => ipcRenderer.invoke('post-its:hide', !!hidden),
  onPostItsHidden: (callback) => subscribe('post-its:hidden', callback),
  // The trash (2026-09-22): the cards in it, newest first, each { id, text, deleted, expires }; and taking one back out.
  postItsTrashed: (projectId) => ipcRenderer.invoke('post-its:trashed', projectId),
  postItsRestore: (projectId, id) => ipcRenderer.invoke('post-its:restore', projectId, id),
  onPostItsTrash: (callback) => subscribe('post-its:trash', callback),
  onPostItsOpenNote: (callback) => subscribe('post-its:open-note', callback),
  onPostItsOpenLink: (callback) => subscribe('post-its:open-link', callback),
  // What the window would open in a new window or tab (a ⌘-click on a link): { url, newTab }, for the Stage. Listening
  // tells main a Stage is there to take it; until then, and after, main sends it to the default browser (src/main/index.cjs).
  onStageOpenLink: (callback) => {
    const off = subscribe('stage:open-link', callback);
    ipcRenderer.send('stage:links', true);
    return () => { off(); ipcRenderer.send('stage:links', false); };
  },
  // Where the sidebar's trash can is (window pixels), so a post-it dropped on it is thrown away; null when there is none.
  postItsTrashRect: (rect) => ipcRenderer.invoke('post-its:trash-rect', rect),
  onPostItsDrag: (callback) => subscribe('post-its:drag', callback),
  onPostItsError: (callback) => subscribe('post-its:error', callback),
  // Pictures of the cards a covering panel is over, to draw under it ({ projectId, cards: [{ id, x, y, width, height, url }] }).
  onPostItsStandIns: (callback) => subscribe('post-its:stand-ins', callback),
  // "Delete task": the post-it into the trash, once its task went to a workspace.
  postItsThrowOut: (projectId, id) => ipcRenderer.invoke('post-its:throw-out', projectId, id),
});

contextBridge.exposeInMainWorld('terminalAPI', terminalAPI);
contextBridge.exposeInMainWorld('engelbartAPI', engelbartAPI);
