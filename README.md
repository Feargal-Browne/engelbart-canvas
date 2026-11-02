# Engelbart (desktop experiment)

A macOS app that turns the *Goal Canvas* design into a working simulation environment: projects, goals, topics, notes and a library on disk under `~/.engelbart/`, an Obsidian-style document with bullet lists, `- [ ]` tasks (typed `@Task`) and inline `@bart` questions, a paper reader with rough.js ink and handwritten margin notes, and the Experimental Terminal engine embedded for real shell / Claude Code / Codex sessions. Nothing talks to a model yet; that is the point.

- Spec (every interpretation listed): `docs/superpowers/specs/2026-09-16-engelbart-desktop-design.md`
- Plan: `docs/superpowers/plans/2026-09-16-engelbart-desktop.md`
- The design it implements, plus your 33 tweak messages: `design/goal-canvas/`
- Verification record: `docs/verification.md`

## Run

Requires macOS, Node 22.12+, and (for the launchers) your installed `claude` / `codex` CLIs.

```sh
npm install          # also rebuilds node-pty for Electron
npm start            # build the renderer and open the app
npm run start:debug  # same, with a DevTools port for scripts/drive.mjs
```

Install as an app on this Mac:

```sh
npm run package                            # release/mac-arm64/Engelbart.app (release/mac/ on an Intel Mac), signed ad hoc
open release/mac-arm64/Engelbart.app
```

A release for other people's Macs (both kinds, a .dmg and a .zip each, an install command and a download page):

```sh
ENGELBART_DOWNLOAD_URL=https://example.com/engelbart npm run dist:mac   # then upload release/upload/ there
```

People install it with `curl -fsSL https://example.com/engelbart/install.sh | bash`, and it updates itself from that folder. The whole procedure, what they see, and signing and notarizing: `docs/releasing-mac.md`. The first launch creates `~/.engelbart/`; a release has no test mode (see First run, test mode, reset).

## Catalog and summaries

While the app is open it sweeps the library once a minute (and at launch, and when the computer wakes). A note longer than 1,000 characters that has been left alone for 30 minutes gets a summary of under 1,000 characters saying why it matters and what is in it; after an edit it is rewritten, with a closing "Changed:" sentence. A PDF that prints an Abstract uses that abstract instead and never calls a model. Each project's `.context/catalog.json` lists its workspaces and items with those summaries.

The model is chosen in `~/.engelbart/config.json`, which is read again for every summary:

```json
"summarizer": {
  "provider": "openai",
  "openai":    { "model": "gpt-6-luna",    "effort": "high" },
  "anthropic": { "model": "claude-opus-5-5", "effort": "high" }
}
```

`provider` is `openai` (Codex CLI) or `anthropic` (Claude Code CLI); effort is `low`, `medium`, `high`, `xhigh` or `max`. Both run as hidden processes on your subscription sign-in, never an API key, and isolated from your own Codex and Claude Code configuration. `ENGELBART_SUMMARIES=off` turns the sweep off.

## The sidebar

Built from the Sidebar workspace's plan (2026-10-07: its requirements, hand-drawn mockup and Iconography; Linear's sidebar the model). From the top:

- **The project**: its name (cut to fit) and chevron open its menu, **Switch project** (every project, this one ticked, then **New project** and **All projects and library**) and **Rename**. Right of it, **Settings** (the settings window) and **Search** (workspaces, this workspace's sources and the library; a pasted link or path is added; ↑↓ and Enter).
- Fixed rows, always there: **Inbox** (the agents that finished and wait for you; its tray wears a dot; a click goes to their workspace, which clears them), **Agents** (running, waiting on you, done: Bart, Brainstorm, Discover and Builds), **Connections** (GitHub, Zotero and Overleaf: the first two are managed in Settings, Overleaf opens on the Stage), **Library** (search the whole library; a click opens a row, its **+** brings it into this workspace; **Open full library**) and **Add sources** (**Note**, **Sticky**, a link or path, **Choose from disk…**, **Add from GitHub…**: added to the library and to this workspace). Each opens beside the sidebar.
- **Workspaces**: the three worked in last (their document saved, or a note typed in while they were open), each folding open onto its sub-workspaces (children only, never grandchildren); where you are is marked. The **+** on the title makes a workspace, a row's **+** (on hover) a sub-workspace in it, each named in a small dialog. Double-click renames; a right click opens, makes a sub-workspace, renames or deletes (into the trash for a week). **More** lists every workspace, and every archived version.
- **Your sources**: this workspace's context under **Starred** (whatever is starred in this project), **Notes**, **Websites**, **Code** (repositories) and **Files**. An open group shows its first few, as many as the section has room for, then **More** (everything, beside the sidebar). Hover a row for its card, its ☆ to star it, its ⊖ to take it out of this workspace (never the library: meta.json `removed` keeps it off the sidebar whatever put it there, until it is brought back); double-click renames; files, pictures or links dropped on the section are added and linked.
- **Hide stickies** / **Show stickies** at the foot (it never makes or deletes one). A post-it dragged onto the foot is thrown away; the trash beside it, while something is in it, brings post-its and deleted workspaces back for a week.

Sections never run past their share of the sidebar: what does not fit is behind **More**. The sidebar folds away from the toggle in the title bar, or ⌘\. Its edge resizes only the document; the edge between document and right pane moves those two (double-click either for its default).

The Browser's address ends in the page's place in the library: **+ Save** (a card names it; *Library only* or *Workspace*), **+ Workspace** (in the library, not here: one click), or **✓**. The `@` menu lists **Bart**, **Task**, **Note** (`@Note name` + Enter makes that note here and mentions it), the page open in the Browser (a **+** when the library does not hold it yet: picking it adds it), then the library. Whatever an `@` mention names comes into the workspace.

## Copy and @bart

**Copy** (at the open document's lower left) puts the open document on the clipboard with every `@[mentioned]` file's content in `<file>` tags directly under the line that mentions it: notes whole (with their own mentions), anything else as its path or URL plus its summary.

**`@bart <question>`** then Enter asks an agent that can read the project's notes and library, read (never edit) the code directory, and search the web. The answer appears under the question as a draft: **Hide** removes it, **Save** keeps it, read-only, ending with which model said it. It runs hidden on your Claude Code or Codex subscription, never an API key.

- No flags: the question starts at the first step of the ladder and the agent moves itself up when it judges the question needs it, keeping what it has read. Claude Code (the default): Sonnet high, Opus high, Fable xhigh. Codex (the default when only Codex is signed in): Sol medium, Sol high, Astra xhigh. Sol is GPT-6.1 Sol, Luna GPT-6 Luna, Sonnet Sonnet 5.5; Opus and Fable are Claude Code's aliases for the latest of each.
- By hand: `@bart --opus --high why …` (also `--fable`, `--sol`, `--luna`, `--xhigh`, `--extra high`). Picking by hand turns moving up off, and is remembered: the next question without flags starts there (the ladder goes on above it), in `~/.engelbart/model-choices.json` beside Build's and a post-it's last picks.
- Or hover the chip beside the send arrow: it names the model and effort the question starts on, and a pick there writes those same flags into the line. Flags the list recognises are slightly bolder.
- Which providers are offered at all: `providers` in `~/.engelbart/config.json` (`["openai", "anthropic"]`).
- The list, the ladders and the default provider: `~/.engelbart/model-effort-inline-question.json`, read again for every question.
- **Settings** (the gear beside the project's name in the sidebar; top right while the sidebar is folded away, and on the other screens) opens the settings window at **Model**: a group per provider, each with Quick, Standard and Deep (a model and an effort each): the levels a plain `@discover` line (Standard) and its `--quick` / `--deep` take, saved to that same file as you pick, used by the next run with no restart. The other agents' defaults stay in the file (`provider`, the ladders, `brainstorm`, `build`); the panel for them is put away for now.
- The instructions it runs under: `src/main/bart/system-prompt.cjs`, or your own in `<data root>/.context/bart-system-prompt.md`.

## Build

**Build** (beside Copy, in the strip under the Workspace tab's document) hands the workspace to Claude Code or Codex, hidden, on your subscription, in a git worktree of its own (`<data root>/worktrees/<project>/<id>`, branch `engelbart/<id>`), so several workspaces can build at once without touching each other or your folder. Design: `docs/superpowers/specs/2026-09-25-build-workflow-design.md`.

- The panel (it opens above the button, no backdrop; the post-it it lands on hides under it, the others stay): **Add from library** (a ringed +, then a search) for items to attach, **Automatically clear workspace** (unticked each time: ticked, Send archives the document right after the Build froze it, the blank one keeping the new card), a line when uncommitted files are left out (a Build starts from your last commit) or the folder cannot take a Build, and at the lower right the model and effort chip with the send in it, as on an @bart line. It starts on the model last picked there, else on Opus high (Sol high when only Codex is signed in; `model-effort-inline-question.json` → `build`). A folder with no git history is given one (git init and a first commit) when the Build starts, without asking; a project folder Engelbart made at onboarding gets its Build repository and first commit in the background as soon as Git is ready.
- What the agent gets: @bart's context (the document with every mention in place, the library as Context.json), what you attached, and the newest archived version of the workspace marked as history; frozen when you press send. What it may reach is `src/main/build/policy.cjs`'s (2026-10-07): it reads and writes outside its worktree too (your notes; elsewhere Claude Code's auto mode or Codex's sandbox and auto-review decide), with your own settings, hooks, permission rules and MCP servers, subagents, and Engelbart's MCP tools to save, duplicate or move a file into the library (`build/engelbart-tools.cjs`); never computer use. Papers and other library files it deletes or replaces are put back after each turn (`build/keep.cjs`), and git refuses commits, pushes, branches, merges, rebases, stashes and settings in the Build's repository (`build/git-guard.cjs`); a branch it moved anyway is put back.
- The card: the document gets one `build> <id>` line, drawn from the Build's record — what it is doing, what it said, `NEEDS YOU:` questions, a reply field (a reply while it works cuts the turn short, its work saved, and goes on in the same session), **Review** (the diff since it started), **Accept**, **Discard** (two clicks), **Resume** (after Stop, a failure or a quit), **Send to agent** (a conflict or failed checks).
- Every turn ends in a checkpoint commit. **Accept** squashes them into one commit on the branch your folder is on, after replaying past whatever you committed meanwhile, running the checks (`project.json` → `build.check`, else `npm test` when there is one) and refusing, with nothing changed, on a conflict, leftover conflict markers, failed checks or your own uncommitted edits to the same files.
- **Clear** saves the document to `<Workspace>/.archive/<time>.md` (plus the ids of what it mentioned) and starts it blank; everything it mentioned stays on the sidebar, and Workspaces' **More** lists the old versions under **Archived** (click to read, **Restore** to bring one back, the current one archived first).
- A post-it's **Build** (Claude Design "Post-it Quick Task", `design/post-it-quick-task/TWEAKS.md`) opens a popup from the card: the model and effort grid (starting on the post-it Build's last pick, else Opus high), **Context** (a library search in a popout beside it), and the send. It runs as a quick task: no questions, a slot of its own, lands by itself when clean. The card's footer then shows **Building** (three dots), **Needs you** or **Stopped**; a click opens the task beside the card: Stop while it works, otherwise a search over every workspace (sub-workspaces too), the model (set to what the task ran on) and the send, which adds it to that workspace. It is put in there as an archived version (`Imported from Task:`, the post-it, the Build's card), the document untouched; the app goes to that workspace (first of ⌘J's recent ones) with that version open, and the card asks **Keep task** or **Delete task** (into the post-it trash). Panels opened by a click (the Build panels) cover the post-its under them: main swaps each covered card for a picture of itself drawn under the panel.
- `ENGELBART_BUILD_FAKE=1` runs a fake agent (git and records stay real) for scripted runs.

## reMarkable

**Settings → Connections → reMarkable → Connect** brings in the notebooks and annotated PDFs from a reMarkable tablet and keeps them up to date. They come from the library the official reMarkable app keeps on this Mac (install it from downloads.remarkable.com, sign in, let it sync): never from reMarkable's cloud, whose terms forbid other software reading it, and never over USB. Nothing is ever written back. macOS asks once whether Engelbart may read the reMarkable app's data; a no is said on the row with a button to Privacy & Security, and a Mac without the app is told where to get it.

- Each document becomes an item of the library of its own, under its name on the tablet: found by the library's search and the @ menu, opened in the Stage's paper viewer (a click), added to workspaces, starred, highlighted and annotated, and given to Bart, as any paper. Behind each is a file in `<data root>/.remarkable/library/`, laid out as the tablet's folders: a notebook as `<name>.pdf` (its pages, the ink drawn in as vectors, typed text as real text), an annotated PDF as the PDF itself with the ink and highlights over its pages, in the tablet's page order (one nobody wrote on is cloned, not rewritten), an ebook as `<name>.md` (its highlights); each with a `<name>.md` of its typed text and highlights beside it when it has any. An item stays the same item while its document does: renamed or moved on the tablet, it is renamed or follows (its ink, highlights, stars and links in Engelbart with it); a name given in Engelbart stays until the tablet's name changes (`src/main/remarkable/rows.cjs`, `.remarkable/rows.json`).
- Synced on connecting, a little after launch, whenever the reMarkable app's library changes (watched), when a window comes to the front after 2 minutes, and every 10. Only documents whose files changed are converted again (in a worker thread); one put in the tablet's trash has its copy and its item taken away. One the reMarkable app simply stops listing is kept, as it was: without a reMarkable Connect subscription its app only holds what was used on the tablet in the last 50 days, so a notebook connected once stays in Engelbart after that (the row says how many are kept so), and comes back as itself if it is opened on the tablet again. A notebook older than that which never synced while Engelbart was connected is not reachable this way: opening it on the tablet brings it into the window. A notebook that cannot be read keeps its last copy, is named on the row, and is tried again when it changes or once in the next run of the app. A library of 320 documents: about 40 s the first time, under 0.1 s when nothing changed.
- **Handwriting is read** with the Mac's own text recognition (Vision, as Live Text does: on the Mac, free, about half a second a page), after the documents are in, newest first ("Reading handwriting… 12 of 140" on the row), and laid into each PDF as invisible text, as a scanned page is made searchable: the library's search, summaries and Bart read it like any PDF's text, and the `.md` beside it has it, marked as read by machine (it makes mistakes). Each page is read once while unchanged (`.remarkable/handwriting/`, by page digest). `ENGELBART_REMARKABLE_HANDWRITING=off` reads none, for scripted runs.
- **Send to reMarkable** (the Stage's ⋮ menu, on a PDF): the PDF is handed to the reMarkable app, which imports it and syncs it to the tablet, under the name it has here; the card says when it has arrived in the app's library. When the app does not take a file by itself, the card offers it to drag into the app's window, reMarkable's own way (`src/main/remarkable/send.cjs`). The highlights made on it in Engelbart go with it, drawn into its pages (as they are when it is sent; sending it again takes the ones made since). A PDF that is not in the library is saved to it first, as Save would keep it. The reMarkable app keeps what it was sent as a document of its own; while nobody has written on it, Connect leaves it out of the library (it is the PDF it came from over again). Once it has ink or highlights, they come back onto the library item it was sent from, under the highlights and notes made in Engelbart: that item shows the tablet's ink drawn on the PDF as it was before Engelbart's highlights went into it (so they are not shown twice), its pages in their own order (pages added on the tablet come after them), and goes back to its own file when the copy is deleted on the tablet or reMarkable is disconnected (`src/main/remarkable/rows.cjs`). Every copy sent from one item comes back onto it, the ink of all of them together. A Stage tab showing the item takes the new ink as it comes, keeping its place.
- **Disconnect** takes the items out of the library and deletes the copies; the reMarkable app's own library is never touched. Which item each document was is kept (`.remarkable/rows.json`), so connecting again brings each back as the same item, with its highlights, notes, stars, mentions and workspaces.
- The reading, drawing and PDF writing are `packages/remarkable-bridge` (a workspace of this repository, TypeScript, compiled by `npm run build`), which knows nothing of Engelbart, so other projects can use it; it also has a command for a terminal, `remarkable` (`list`, `read <name>`, `save <name>`). Engelbart's side is `src/main/remarkable/` (`sync.cjs`, `convert.cjs`, `rows.cjs`, `send.cjs`) and the Stage's `SendToRemarkable.jsx`. `ENGELBART_REMARKABLE_LIBRARY` names another copy of the tablet's files, for scripted runs only. Checks: `npm test` (`test/remarkable.test.cjs`, `test/remarkable-send.test.cjs`, `test/connections-ui.test.cjs`), and the package's own `bun test` in `packages/remarkable-bridge`. Why it is built this way (the cloud's terms, the file format, where ink goes): `docs/remarkable-research.md`.

## GitHub repository previews (E2B)

A GitHub repository added to the library (or linked into a workspace) is cloned into an E2B sandbox, set up by a local Claude Code task on your subscription through tools bound to that one sandbox (the Anthropic API as an optional fallback), and served as a verified live preview. Saved repositories are prepared once per app session. The bell at the top right of every screen follows each one through **Building…**, **Build finished** or **Build failed**; its inspector has the Build steps, the Logs and the app's Environment variables (encrypted with the system keychain, applied by **Save & restart app** in the same sandbox). Quitting stops every sandbox. The E2B key always comes from your GitHub sign-in: an `E2B_API_KEY` in a settings file or a packaged app's environment is ignored, and only an unpackaged build honors one from the process environment. Private repositories work when the Engelbart GitHub App can read them: the sandbox gets a download link for that one archive, never your sign-in. Details, configuration and verification: [docs/sandbox-runs.md](docs/sandbox-runs.md); the runner template: [docs/e2b-template-migration.md](docs/e2b-template-migration.md), [docs/sandbox-cache.md](docs/sandbox-cache.md). `ENGELBART_SANDBOXES=off` turns them off for scripted runs.

## Project post-its (prototype)

**Add sources → Sticky** in the sidebar adds a titleless post-it. The card uses `design/assets/yellow-sticky-note.svg`, including its paper texture, curled corner, and transparent shadow. The card uses the note editor's font and inline Markdown. Click text to edit; drag blank space to move; drag the curled corner to resize (or focus the grip and use arrow keys). Let go over the sidebar's foot to throw it away (while a card is dragged the foot says so and darkens under the pointer, and the card takes a red tint); the trash beside **Hide stickies** brings it back for a week. Escape cancels a drag.

Cards belong to the project and remain visible across its workspaces and notes. Content and preferred layout persist in `post_its` inside the project's `notes.pglite`. A smaller window temporarily clamps the cards into view. There is no hidden/completed state, drawer, attachment picker, or `@btw` command in this prototype.

Each card is an app-owned `WebContentsView` above the live browser. Its restricted preload can edit only that card. Native browser tabs are restacked below cards, and cards temporarily yield to app dialogs/menus. Each view has a substantial renderer cost: approximately 100 MB working set per card in the development smoke run; this architecture is intended for trying the interaction, not hundreds of cards.

Verification: `npm test`, then `npm run build && npx electron scripts/smoke-post-its.cjs`. The smoke test uses a hidden window and disposable data, checks editing/geometry/browser interaction/trash, and prints a checkpoint directory. To check a full relaunch:

```sh
ENGELBART_POST_IT_SMOKE_ROOT=/path/from/checkpoint ENGELBART_POST_IT_SMOKE_RESTORE=1 npx electron scripts/smoke-post-its.cjs
```

## Git, Claude Code and Codex

Checked at every launch, in the background (`src/main/tools/`; design: `docs/superpowers/specs/2026-09-23-tools-and-defaults-design.md`). What the last check saw is written to `~/.engelbart/config.json` → `tools`: for each, `installed` (false until a check finds it), `version`, `requires` (from `src/main/tools/requirements.cjs`: Git ≥ 2.30.0, Claude Code ≥ 2.1.278, Codex ≥ 0.155.0), `status`, `signedIn`, `path`, `source`, `error`. These are rewritten by every check; edit only `skip`, `pin` (a version Engelbart must never update) and `tools.updates` (`auto` | `ask`).

The app carries its own Git (2.53.0 from dugite-native, GitHub Desktop's build; `scripts/fetch-git.mjs` puts it in `vendor/git` for a checkout, electron-builder in the app's Resources). It stands in only when the Mac has no Git of its own that works (a Mac without Apple's developer tools has just `/usr/bin/git`, a stub that opens Apple's installer): then its record says `source: "bundled"`, the dialog shows it as `· built in`, and its folder goes first on PATH for everything Engelbart starts (@bart, Build, summaries, the terminal), after the login shell's startup files (`src/main/tools/bundled-git.cjs`, `src/main/terminal/launch.cjs`). Claude Code or Codex installed where the login shell's PATH does not reach (a new account's `.zshrc` never adds `~/.local/bin`, where both installers put them) is run by its full path, and its folder goes last on PATH for the terminal, so `claude` and `codex` work there by name. On a Mac with neither Claude Code nor Codex, Claude Code is installed at launch without asking (unless skipped); the dialog then asks you to sign in as soon as the install ends.

When something needs you — Git missing, neither agent installed, an agent installed but not signed in, an update waiting for approval, an install that failed — a dialog opens after the check: Install (Git through Apple's Command Line Tools dialog; Claude Code and Codex through their vendors' installers), Update, Sign in (the CLI's own login, which opens the browser), Skip (with a warning; remembered per tool). **Engelbart ▸ Set Up Tools…** shows all three at any time, with Ask again and Update automatically. A tool below its minimum is updated by itself at launch unless it is pinned, skipped, `updates` is `ask`, or you turned the CLI's own updater off (`autoUpdates: false` in `~/.claude.json`, `DISABLE_AUTOUPDATER`, Codex's `check_for_update_on_startup = false`).

@bart starts on the saved default provider when its CLI can run, else on the other one; nothing is written. `config.json` and `model-effort-inline-question.json` take new defaults from later builds wherever you left a value alone (`src/main/store/defaults.cjs`).

## Terminal pane

Each tab is a real PTY (the Experimental Terminal engine). While the shell is idle you type into the **Run commands** box at the bottom, like a chat: Enter sends, ↑/↓ recall your shell history, and the transcript above starts empty and does not take keys. While a program runs — an arrow-key menu, a REPL, Claude Code or Codex, started from the dropdown or by typing its name — the keyboard belongs to the transcript, as in any terminal, and the box comes back when the program ends. The dropdown at the right of the tab strip turns an untouched terminal into the agent in place, so to choose an agent's directory: click the `▭` chip, pick the folder, pick the agent. The mechanism (a launcher plus zsh wrapper startup files that blank the prompt and emit shell-integration marks, then hand your configuration back) is described in `src/main/shell-rc.cjs`; bash and fish are left alone.

## Restarting after a code change

```sh
npm run relaunch                 # quit every running copy, rebuild + repackage, open release/…/Engelbart.app
npm run relaunch -- --dev        # quit, rebuild, run `electron .` in the background instead (faster, same data)
npm run relaunch -- --no-build   # just quit and reopen
```

It works from a terminal inside Engelbart too (say, from a Claude Code session running there): quitting Engelbart closes that terminal, so the script hands the rest to a detached copy (log: `~/Library/Logs/Engelbart-relaunch.log`) and you resume the agent afterwards with `claude -r`. `--dry-run` says what would happen without touching anything.

Both use the real data root, `~/.engelbart`. The packaged app under `release/` only changes when it is repackaged, so opening it from Finder after a code change shows the old build. `ENGELBART_HOME_DIR` (a different data root) is for scripted test runs only; the relaunch script clears it.

## First run, test mode, reset

With no project in the current root the app opens on **Create a new project** (name + `./slug` path). Creating a project makes `<root>/<slug>/`, a first goal *First steps*, a first topic *Getting started* and a *Welcome!* note, and opens the workspace with that note. From then on the app opens straight into the topic you were last in (`<root>/state.json`); `Engelbart` in the header, or Escape, shows all projects — a card grid that ends with a dashed **+ Project** card. There is no kanban screen: the goal crumb in the header lists the project's goals and adds new ones.

The pill top-right exists on every screen of a developer's copy. **Test · on** roots the app at `~/.engelbart/test/` and seeds that library once (the HypoCompass paper, its repository, the arXiv page, a small dataset); the Settings gear beside it has, in test mode, a **Test data** page that can reveal the folder, **Start as a new user…** or **Reset everything…** (native confirmation, then `~/.engelbart/test/` is deleted and recreated). **Test · off** roots the same app at `~/.engelbart/` with its own library database and no seeds. A new install starts with it off.

Test mode is only in a developer's copy (`src/main/developer.cjs`): Engelbart run from a checkout (`npm start`, `npm run relaunch -- --dev`), or packaged by `npm run relaunch`, which builds with `ENGELBART_DEVELOPER=1`. Any other package, which is what ships, has no pill and no `⚙`, uses `~/.engelbart` whatever `config.json` says (without rewriting it, so a developer's copy on the same Mac keeps its setting), refuses the switch and the reset, and never makes `~/.engelbart/test/`. A release has to be built with `npm run build` right before packaging, without `ENGELBART_DEVELOPER`: the build writes `dist/build.json`, which is what the package reads. `ENGELBART_TEST_MODE=off` takes test mode away from a developer's copy too, to see the app as it ships (`npm run new-mac` sets it).

## Connect your library

In every library, test mode's or not and in the app people download (2026-10-08; it was test mode's only until then), a new user's onboarding has **Connect your library** in place of Add to your library and Custom instructions (Claude Design "Connect Library", `design/connect-library/`): welcome, tools, Connect, create, context. Its agents run on Claude Code or Codex, so the tools screen comes first whenever neither is installed **and signed in**, with Install and Sign in on each agent's row; skipping it without one brings the two old screens back. Someone with projects already gets it once, as a popup over the workspace they are in (Not now dismisses it for good); each library keeps its own offer, sessions and MEMORY.md, so a run in test mode never touches `~/.engelbart`.

- **Choose**: what should come in — notes (Obsidian, Notion, Apple Notes, OneNote, Google Docs, Evernote), meeting transcripts (Granola, Google Meet, Zoom), AI chats (ChatGPT, Codex, Claude, Claude Code, Grok, Gemini, Perplexity, Cursor), websites, papers (Zotero, Overleaf, a folder), code (GitHub through onboarding's own repository list, local folders) — ticked where the app is found on this Mac or signed in to in Engelbart's browser. **Agents do all of this for you** asks for what they need, one line each, with no paragraphs of explanation: read files on this Mac (the home folder, or only the folders picked), use the person's accounts in the background (the web apps picked), ask ChatGPT and Claude (Gemini, Grok) what they remember (one new chat each), let Engelbart read Apple Notes (macOS asks), sign in to Granola's or Notion's connector. Nothing is brought over from Chrome. Only the provider is chosen, **Claude Code** or **Codex**; every agent here runs on Sonnet high or Sol high, pinned, with no ladder to climb (`src/main/connect/session.cjs` `CONNECT_MODELS`).
- **Refine**: one chat with the librarian. Its questions are cards with one option per line (round mark: one; square: several), each option's why under it, a field for the person's own words, Skip and Submit; its buttons sign in to a connector or Engelbart's own sign-in, ask macOS, or choose a folder for an app on this Mac. Nobody is told to export or download anything. Survey agents look at each web or connector app first (Google Drive's recent files and folders, ChatGPT's and Claude's chats and projects, Overleaf's projects, Granola's meetings) and report what is there with ids, so the librarian offers the person's own files and chats to pick one by one. Each source it settles goes to an import agent at once, in the background.
- **The agents' browser** (`src/main/connect/browser.cjs`): a real Chromium window of Engelbart's, never shown, one per agent, on the Stage's sign-ins: it opens, reads (text and controls with refs), clicks, types, waits, takes pictures, runs a script in the page and downloads, only on its apps' sites and their sign-in pages (anything else refused and logged); it never reads a password field and never types one. Nothing takes over the screen, so macOS's Accessibility and Screen Recording are never asked for. ChatGPT's and Claude's chats are read from their signed-in pages (`web-chats.cjs`), Google Docs exported as Markdown by id, Overleaf projects downloaded as source zips, Granola and Notion through their official MCP servers with Engelbart's OAuth sign-in (`connectors.cjs`, tokens sealed in `<data root>/connectors.json`), Apple Notes through macOS Automation (`apple-notes.cjs`), Cursor's chats from its database (`cursor.cjs`). How each app is reached is written down per app (`skills.cjs`; `<data root>/.context/connect-skills/<App>.md` replaces one); when what an agent sees does not match, it reads the app's help pages (WebSearch, WebFetch) and says what changed.
- **Needs you**: a sign-in, a code, a password, a captcha or a permission only the person can give comes back to the window as an amber card with one button at its right and **Skip**: **Log in** opens that agent's own window on the sign-in page (the agents use Engelbart's browser's sign-ins, so a sign-in in another browser would not reach them; closing the window carries on), a connector's sign-in opens in the default browser, **Allow** asks macOS. **Skip** holds for the run: that app is left out, its queued work ends as skipped, and no agent asks about it again. One card per app.
- **The chat**: no strip of agents above it. One line under it, beside **Import**, says what the librarian is doing and goes through the subagents at work one at a time, as Claude Code lists its own; it never grows.
- **Import** sits at the lower right and lights up once the librarian has nothing more to ask; it hands over whatever is left with sensible defaults. The window then lists every survey, recall and import, the ones still going first (Stop on each, **Stop all**), and MEMORY.md, with no account of what each brought in and no activity log (the steps are still kept in `session.json`). It can be put away: it goes on in the background, a chip in the top-right controls says how (amber when it needs the person) and opens it again, and the sidebar's **Inbox** lists it when it needs the person or is done (a press opens it; **Mark all as seen** clears the finished ones).
- **What comes in** (2026-10-08): notes, chats and documents become Markdown files of the library's own, `<data root>/assets/md/<id>/<title>.md` with their pictures beside them, rows of type `md` with no `note` tag and no project, not notes of a project. Papers, files and links are library rows as before.
- **Quitting**: a session still going when Engelbart quits (or switches library) is saved as it is and picked up again the next time that library is open: what was running or queued runs again (an import skips what came in before), a librarian turn that had not answered is asked again, and MEMORY.md is written once everything has ended. Onboarding shows that session again instead of a new one. Stop is for good; a session older than a week is left alone.
- **The queue**: surveys first, then the recalls, then imports, three at a time; MEMORY.md waits until everything else has ended.
- **MEMORY.md** (`src/main/connect/memory.cjs`), beside `config.json` in the data root (in test mode `~/.engelbart/test/MEMORY.md`): an agent writes it from the chat, what came in, what the AI assistants answered (`prompts.cjs` `RECALL_PROMPT`, the custom instructions step's research-profile prompt adapted) and what Claude Code and Codex keep (`~/.claude/CLAUDE.md`, Codex's `AGENTS.md`), updating the one there; a Claude Sonnet agent takes secrets out, a shape check masks any left (keys, tokens, `password:` lines), and only then is it saved, the old version kept in `.connect/memory-history/`. @bart and Build are given it as `<memory>`, beside the custom instructions.
- `ENGELBART_CONNECT_FAKE=1` (or `ENGELBART_BART_FAKE=1`) runs it without a model; `ENGELBART_CONNECT_FAKE_NEEDS=<app>` makes that app's survey hand over its sign-in; `ENGELBART_CONNECT_OFFER=off` never shows the one-time popup (the other smokes set it, so it does not cover their workspace). Checks: `npm test` (`test/connect.test.cjs`), `npx electron scripts/smoke-connect.cjs` (the whole flow, hidden, in the normal library with test mode off; `ENGELBART_CONNECT_SHOTS=<dir>` for pictures), `npx electron scripts/smoke-connect-tools.cjs` (signing an agent in first, in test mode) and `npx electron scripts/smoke-connect-browser.cjs` (the agents' browser on a page served locally).

## What lands on disk

```
~/.engelbart/                         (test mode: ~/.engelbart/test/, same shape, plus seed/)
  config.json  state.json             test toggle, providers, summarizer, github, tools; { projectId, workspaceId } to reopen
  model-effort-inline-question.json   @bart's models, efforts and ladders; @brainstorm's and @discover's steps; Build's models, provider and default
  model-choices.json                  the model and effort last picked by hand for @bart, Build and a post-it's Build
  .defaults/<file>                    the defaults each of those two was last given (how new defaults reach them)
  library.pglite/                     table `library`: every md, pdf, folder, website, data file, image; `type` is the format, `tags` what was inferred: paper, git, note (+ summary, summary_edited, char_count)
  .context/status.json                the last summary sweep that did something
  .context/summary-system-prompt.md   optional: replaces the built-in summary prompt
  MEMORY.md                           what Engelbart learned about the person when it connected their library; @bart and Build read it
  assets/md/<id>/<title>.md           a note, chat or document Connect your library brought in, its pictures beside it
  connectors.json                     the connectors' OAuth tokens (Granola, Notion), sealed with the keychain
  .connect/<id>/                      a Connect your library session (session.json: chat, jobs, action log, what resuming after a quit needs; memories/ what each AI assistant answered)
  .connect/imported.json              what came in from where (never twice); offer.json: the one-time popup was seen; memory-history/: MEMORY.md's earlier versions
  imports/<id>/                       what that session's agents downloaded (Overleaf projects, Drive files, pictures of Apple Notes)
  annotations/<library id>.json       PDF highlights and margin notes
  .remarkable/library/                the reMarkable app's notebooks as PDFs and Markdown, each a library item; state.json what was converted from which version, rows.json which item is which document
  .backups/<project>-<time>/          copies taken before a layout conversion (and of a settings file's first merge)
  <project>/
    project.json                      { id, name, created, directory }   directory = where the code lives
    notes.pglite/                     tables `notes` (topic_id holds the workspace id), `post_its` (text and preferred layout)
    <Note>.md                         notes, flat
    assets/<id>.png                   pasted images (library rows of type `image`)
    .context/catalog.json             what the project holds, with summaries, for agents that read files
    <Workspace>/workspace.md          a workspace's document
    <Workspace>/meta.json             { id, status, context: [library ids], removed: [library ids the trash took off], created, builds: [ids], archives: [{ file, clearedAt, title }] }
    <Workspace>/.archive/<time>.md    the document when Clear was pressed; <time>.json: what it had linked and mentioned (ids)
    <Workspace>/<Child>/…             workspaces nest to any depth
    builds/<id>/task.json             a Build: provider, model, session, worktree, branch, base, status, checkpoints, conversation
    builds/<id>/context.md            what it was given, frozen at Build
  worktrees/<project>/<id>/           a running Build's checkout (removed at Accept or Discard)
    .legacy/                          goal directories from the first layout, parked, never deleted
```

Terminals, Claude Code and Codex start in the project's `directory`. A project without one opens behind a modal until you pick a folder. Projects in the first layout (`<project>/<Goal>/<Topic>/`) are converted the first time the app opens them; preview with `npm run migrate -- --dry-run`.

## Layout of the code

```
src/main/index.cjs           app lifecycle, window, engelbart:// protocol, menu, terminal IPC (from Experimental Terminal)
src/main/ipc.cjs             engelbart:* handlers, argument validation, lazy store context + seeding
src/main/store/              home layout + config, PGlite databases, projects/goals/topics/notes/docs, library + annotations
src/main/terminal/           Experimental Terminal engine (session manager, launch, settings)
src/main/tools/              Git, Claude Code, Codex: requirements, detect, install/update/rollback, lock, sign-in, manager; repository checks for Build; bundled-git (the app's own Git)
src/main/updates.cjs         new versions of the packaged app (docs/releasing-mac.md)
src/main/build/              Build: git (worktrees, checkpoints, Accept), store (task records), context, prompt, policy (the sandbox stub), runner (one CLI turn), manager
src/main/store/archive.cjs   Clear, the archived versions of a workspace, Restore
src/main/browser/            views.cjs: the Browser pane's pages as WebContentsViews (decision 48)
src/main/connect/            Connect your library: readers and scan of this Mac, the agents (librarian, survey, recall, import, MEMORY.md), their tools and skills, the hidden browser, connectors, Apple Notes, Cursor, the session
src/main/remarkable/         reMarkable: the reMarkable app's library on this Mac mirrored as library items (sync, convert in a worker, rows)
packages/remarkable-bridge/  reading reMarkable documents (.rm pages, sources, SVG, PDF, Markdown): an npm workspace, usable outside Engelbart
src/main/sandbox/            E2B previews of GitHub repositories: manager (runs, lifecycle), worker (forked; the E2B SDK), local Claude setup + its MCP tools, the Python helpers run inside the sandbox
src/preload.cjs              window.terminalAPI (ET contract) + window.engelbartAPI
src/renderer/App.jsx         create | all projects | workspace; reopens the last topic; the test pill
src/renderer/screens/        CreateProject, Home (all projects), Workspace (three-column header: the sidebar's toggle, doc tabs, pane switcher)
src/renderer/workspace/      Rail (the sidebar: project, fixed rows, Workspaces, Your sources, stickies) and SidebarPanels (what it opens beside itself), DocTabs, DocEditor (+ MentionMenu, Popover), RightPane, Browser (+ Save)
src/renderer/pdf/PaperView   pdf.js + rough.js + Caveat
src/renderer/terminal/       the Terminal pane (tabs, cwd chip, Terminal / Claude Code / Codex switcher) over terminalAPI; sessions survive navigation
src/renderer/model/doc.js    the pure editor model (regexes, task and bullet lines, caret offset mapping)
src/renderer/model/rail.js   what the library searches and the @ menu list
src/renderer/model/sidebar.js what the sidebar lists: sources by kind, the workspaces worked in last, inbox and agents, each section's share
scripts/drive.mjs            CDP driver for exploratory testing (screenshots, clicks, typing)
scripts/package-mac.mjs      npm run package / dist:mac (electron-builder.config.cjs); fetch-git, install-mac.sh, release-site, make-icon: the rest of a release
```

## Tests

```sh
npm test            # stores, databases, editor model, IPC validation, terminal helpers
npm run test:pty    # real PTY round trip under Electron's ABI
```

Exploratory testing against a running app:

```sh
npm run start:debug
node scripts/drive.mjs shot /tmp/home.png
node scripts/drive.mjs clicksel "[data-right-mode='terminal']" -- wait 800 -- shot /tmp/terminal.png
node scripts/drive.mjs errors          # anything the renderer caught
```

To test against a scratch home instead of your real `~/.engelbart`:

```sh
ENGELBART_HOME_DIR=/tmp/eb-home electron . --user-data-dir=/tmp/eb-userdata --remote-debugging-port=9223
ENGELBART_DEBUG_PORT=9223 node scripts/drive.mjs text
```

`ENGELBART_TOOLS_FAKE='{"git":"missing","claude":"2.1.300 signed-out","codex":"0.150.0","failInstall":["codex"]}'` pretends a machine (each tool `missing`, `broken`, or a version with an optional ` signed-out`; Git also `bundled`) so the setup dialog can be driven without touching real installs; `ENGELBART_TOOLS=off` skips the launch check; `ENGELBART_GIT=bundled` uses the app's own Git even where the Mac has one; `ENGELBART_UPDATES=off` stops a packaged app checking for new versions. `ENGELBART_CONFIRM_ALL=1` makes the native confirmation dialogs (reset, a new version's offer) answer yes, for scripted runs only. So are `ENGELBART_SUMMARY_FAKE=1` (no model, a recognisable blurb), `ENGELBART_SUMMARY_QUIET_MS` and `ENGELBART_SUMMARY_INTERVAL_MS` (shorten the 30-minute and one-minute clocks).

## Known kinks (deliberately open)

See spec §9: library ingestion beyond seeds (test seeds only; the normal root starts empty), whether goals/topics want SQL rows, deletion, note↔goal association living in the notes table rather than frontmatter, simulated build/chat, images in documents, one project open at a time.
