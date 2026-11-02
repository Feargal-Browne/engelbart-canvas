'use strict';

// Send to reMarkable (src/main/remarkable/send.cjs): a PDF handed to the reMarkable app, its arrival seen in the app's
// library, and the drag into the app when it does not take the file by itself. The app and its library are fakes.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createRemarkableSend } = require('../src/main/remarkable/send.cjs');

const PDF = new TextEncoder().encode('%PDF-1.7\n1 0 obj << >> endobj\n%%EOF\n');
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'remarkable-send-'));

/** A reMarkable app: `takes` whether it imports what it is opened with; its library a list of entries. */
function fakeApp({ takes = true, installed = true, readable = true } = {}) {
  const library = [{ id: 'old', name: 'Already there', kind: 'document', trashed: false }];
  const opened = [];
  return {
    library, opened,
    deps: {
      findApp: async () => (installed ? '/Applications/reMarkable.app' : null),
      open: async (app, file) => {
        opened.push({ app, file, bytes: fs.readFileSync(file) });
        if (takes) library.push({ id: `new-${opened.length}`, name: path.basename(file, '.pdf'), kind: 'document', trashed: false });
      },
      list: async () => { if (!readable) throw Object.assign(new Error('no'), { code: 'permission' }); return [...library]; },
      sleep: async () => {},
      waitMs: 50, dropWaitMs: 50, pollMs: 1,
    },
  };
}
const clock = () => { let t = 0; return () => (t += 10); };

test('the app takes the PDF: sent, under its name, the bytes as they were', async () => {
  const app = fakeApp();
  const send = createRemarkableSend({ ...app.deps, dir: tmp(), now: clock() });
  const result = await send.send({ name: 'Attention: is all / you need', bytes: PDF });
  assert.deepEqual(result, { state: 'sent', name: 'Attention- is all - you need' });
  assert.equal(app.opened.length, 1);
  assert.equal(path.basename(app.opened[0].file), 'Attention- is all - you need.pdf');
  assert.deepEqual(new Uint8Array(app.opened[0].bytes), PDF);
});

test('the app does not take it: the file to drag in, then sent once it arrives', async () => {
  const app = fakeApp({ takes: false });
  const send = createRemarkableSend({ ...app.deps, dir: tmp(), now: clock() });
  const result = await send.send({ name: 'Paper', bytes: PDF });
  assert.equal(result.state, 'drop');
  assert.ok(send.owns(result.file), 'the window may drag this one');
  assert.equal(send.owns('/etc/hosts'), false, 'and nothing else');
  assert.equal(send.owns(path.join(send.dir, '..', 'x.pdf')), false);
  app.library.push({ id: 'dropped', name: 'Paper', kind: 'document', trashed: false });
  assert.deepEqual(await send.awaitDrop({ name: result.name, since: result.since }), { state: 'sent', name: 'Paper' });
});

test('a document of the same name already there is not taken for the new one', async () => {
  const app = fakeApp({ takes: false });
  const send = createRemarkableSend({ ...app.deps, dir: tmp(), now: clock() });
  const result = await send.send({ name: 'Already there', bytes: PDF });
  assert.equal(result.state, 'drop');
  assert.deepEqual(await send.awaitDrop({ name: result.name, since: result.since }), { state: 'waited', name: 'Already there' });
});

test('the app\'s library cannot be read: handed over, not confirmed', async () => {
  const app = fakeApp({ readable: false });
  const send = createRemarkableSend({ ...app.deps, dir: tmp(), now: clock() });
  assert.deepEqual(await send.send({ name: 'Paper', bytes: PDF }), { state: 'given', name: 'Paper' });
});

test('not a PDF, or no reMarkable app: said in words, nothing opened', async () => {
  const app = fakeApp();
  const send = createRemarkableSend({ ...app.deps, dir: tmp(), now: clock() });
  await assert.rejects(send.send({ name: 'x', bytes: new TextEncoder().encode('hello') }), (e) => e.code === 'not-pdf');
  const none = fakeApp({ installed: false });
  await assert.rejects(createRemarkableSend({ ...none.deps, dir: tmp(), now: clock() }).send({ name: 'x', bytes: PDF }), (e) => e.code === 'no-app' && /downloads\.remarkable\.com/.test(e.message));
  assert.equal(app.opened.length + none.opened.length, 0);
});

// From the audit (2026-10-31): copies go once they have arrived, waits end when the card closes, nameless names stay apart.
test('a copy goes once it has arrived; copies older than a day go on the next send', async () => {
  const app = fakeApp();
  const dir = tmp();
  const old = path.join(dir, 'stale');
  fs.mkdirSync(old);
  fs.writeFileSync(path.join(old, 'Old.pdf'), PDF);
  const day = 24 * 60 * 60_000;
  fs.utimesSync(old, new Date(Date.now() - 2 * day), new Date(Date.now() - 2 * day));
  const send = createRemarkableSend({ ...app.deps, dir, now: () => Date.now() });
  await send.send({ name: 'Paper', bytes: PDF });
  assert.deepEqual(fs.readdirSync(dir), [], 'the arrived copy and the stale one are both gone');
});

test('closing the card ends the wait for a drop', async () => {
  const app = fakeApp({ takes: false });
  let t = 0;
  const send = createRemarkableSend({ ...app.deps, dir: tmp(), now: () => (t += 1), dropWaitMs: 1e9, sleep: () => new Promise((r) => setImmediate(r)) });
  const result = await send.send({ name: 'Paper', bytes: PDF });
  const waiting = send.awaitDrop({ name: result.name, since: result.since, file: result.file });
  await new Promise((r) => setImmediate(r));
  send.cancel(result.name);
  assert.deepEqual(await waiting, { state: 'waited', name: 'Paper' });
});

test('a name of only dots or spaces is sent under a dated name, not "Untitled"', async () => {
  const app = fakeApp();
  const send = createRemarkableSend({ ...app.deps, dir: tmp(), now: () => Date.parse('2026-10-31T12:30:00Z') });
  const result = await send.send({ name: ' . .. ', bytes: PDF });
  assert.equal(result.name, 'From Engelbart 2026-10-31 12.30');
});

test('the sync is told before the app is given the PDF, from which library row, and which document its copy became', async () => {
  const app = fakeApp();
  const told = [];
  const send = createRemarkableSend({ ...app.deps, dir: tmp(), now: clock(), expect: (name, row) => told.push(['expect', name, row, app.opened.length]), arrived: (e) => told.push(['arrived', e.id, e.name]) });
  await send.send({ name: 'Paper', bytes: PDF, from: 'row-1' });
  assert.deepEqual(told, [['expect', 'Paper', 'row-1', 0], ['arrived', 'new-1', 'Paper']]);
  told.length = 0;
  await send.send({ name: 'Loose', bytes: PDF });
  assert.equal(told[0][2], null, 'a PDF the library does not hold is from no row');
});
