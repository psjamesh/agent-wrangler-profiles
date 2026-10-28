import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ProfilesStore } from '../store.js';
import manifest from '../index.js';

function setup(t) {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'profiles-store-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'profiles.json');
  return { file, store: new ProfilesStore(file) };
}
const live = new Set(['a', 'b', 'adhoc']);
const profile = (id, name, taskIds) => ({ id, name, taskIds });

test('saves creation, rename, deletion and memberships as one durable revision', t => {
  const { file, store } = setup(t);
  store.save([profile('one', 'First', ['a', 'a', 'gone']), profile('two', 'Empty', [])], 0, live);
  assert.deepEqual(store.snapshot(), { revision: 1, profiles: [profile('one', 'First', ['a']), profile('two', 'Empty', [])] });
  store.save([profile('one', 'Renamed', ['b', 'adhoc'])], 1, live);
  assert.deepEqual(new ProfilesStore(file).snapshot(), store.snapshot());
  const copy = store.snapshot();
  copy.profiles[0].taskIds.push('a');
  assert.deepEqual(JSON.parse(readFileSync(file)).profiles, [profile('one', 'Renamed', ['b', 'adhoc'])]);
});

test('rejects stale and invalid saves without changing disk or memory', t => {
  const { file, store } = setup(t);
  store.save([profile('one', 'First', ['a'])], 0, live);
  const before = readFileSync(file, 'utf8');
  for (const [profiles, revision] of [
    [[profile('one', 'Stale', [])], 0],
    [[profile('one', '', [])], 1],
    [[profile('one', 'A', []), profile('one', 'B', [])], 1],
    [[profile('bad/id', 'A', [])], 1],
    [[profile('one', 'A', [null])], 1],
  ]) assert.throws(() => store.save(profiles, revision, live));
  assert.equal(readFileSync(file, 'utf8'), before);
  assert.equal(store.snapshot().revision, 1);
});

test('prunes archived/deleted memberships durably and retains empty profiles', t => {
  const { file, store } = setup(t);
  store.save([profile('one', 'First', ['a', 'b', 'adhoc'])], 0, live);
  assert.equal(store.prune(new Set(['adhoc'])), true);
  assert.equal(store.prune(new Set(['adhoc'])), false);
  assert.deepEqual(new ProfilesStore(file).snapshot().profiles[0].taskIds, ['adhoc']);
});

test('corrupt state is reported instead of silently replaced', t => {
  const { file } = setup(t);
  writeFileSync(file, '{broken');
  assert.throws(() => new ProfilesStore(file), /JSON/);
  assert.equal(readFileSync(file, 'utf8'), '{broken');
});

test('manifest aligns with install declaration and prunes on every graph', t => {
  const { store } = setup(t);
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url)));
  for (const [key, value] of Object.entries(pkg.wranglerExtension)) assert.deepEqual(manifest[key], value);
  assert.equal(manifest.engines.wranglerApi, '^1.53.0');
  store.save([profile('one', 'First', ['a', 'b'])], 0, live);
  const host = { stores: { profiles: store }, tasks: { adhocId: 'adhoc', list: () => [{ taskId: 'a' }, { taskId: 'b', archived: true }] } };
  assert.deepEqual(manifest.graph({ host }).profiles.profiles[0].taskIds, ['a']);
  manifest.onTaskDelete({ taskId: 'a', host });
  assert.deepEqual(store.snapshot().profiles[0].taskIds, []);
});

test('control save replies only to its token and rejects concurrent stale edits', async t => {
  const { store } = setup(t);
  const messages = [];
  let rebuilds = 0;
  const host = { stores: { profiles: store }, tasks: { adhocId: 'adhoc', list: () => [{ taskId: 'a' }] }, rebuild: async () => rebuilds++, broadcast: m => messages.push(m) };
  const handler = manifest.handlers.find(h => h.type === 'profiles-save');
  await handler.handler({ requestId: 'request-a', revision: 0, profiles: [profile('one', 'First', ['a', 'b'])] }, host);
  assert.equal(messages[0].requestId, 'request-a');
  assert.equal(messages[0].ok, true);
  assert.equal(rebuilds, 1);
  await handler.handler({ requestId: 'request-b', revision: 0, profiles: [] }, host);
  assert.equal(messages[1].ok, false);
  assert.match(messages[1].error, /changed/);
  assert.deepEqual(store.snapshot().profiles[0].taskIds, ['a']);
});
