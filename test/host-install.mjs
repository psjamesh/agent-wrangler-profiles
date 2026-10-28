import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

const core = process.env.AW_CORE_DIR;
assert.ok(core && process.env.AW_DATA_DIR, 'Set AW_CORE_DIR and isolated AW_DATA_DIR');
const root = fileURLToPath(new URL('..', import.meta.url));
const load = rel => import(pathToFileURL(path.join(core, rel)));
const { extInstallHandler, extConsentHandler, _setInstallRunnersForTests } = await load('server/control/handlers/extensions-install.js');
const { loadExtensions, registerExtension, unregisterExtension } = await load('server/extensions/index.js');
const { npmCi } = await load('server/extensions/install.js');
const { HOST_API_VERSION } = await load('server/host-api/version.js');
const replies = [], loaded = loadExtensions({ cfg: {}, builtin: [] });
const ctx = {
  ext: {
    list: loaded.list, manifests: loaded._manifests,
    register: (m, o) => registerExtension(loaded, m, o),
    unregister: (id, o) => unregisterExtension(loaded, id, o),
    activate() {}, deactivate() {}, quarantine() {}, changed() {},
  },
  reply: m => replies.push(m), broadcast() {}, rebuild: async () => {},
};
_setInstallRunnersForTests({
  clone: async (_url, dest) => {
    fs.mkdirSync(dest, { recursive: true });
    for (const name of ['index.js', 'store.js', 'package.json', 'package-lock.json', 'public']) fs.cpSync(path.join(root, name), path.join(dest, name), { recursive: true });
  },
  head: async () => '0'.repeat(40),
  npm: npmCi,
});
await extInstallHandler.handler({ url: 'https://github.com/psjamesh/agent-wrangler-profiles' }, ctx);
if (process.env.EXPECT_OLD === '1') {
  const refused = replies.find(m => m.type === 'ext-install-incompatible');
  assert.ok(refused);
  assert.equal(replies.some(m => m.type === 'ext-install-disclosure'), false);
  console.log(`PASS: host API ${HOST_API_VERSION} rejects ^1.53.0 before consent: ${refused.message}`);
} else {
  const disclosure = replies.find(m => m.type === 'ext-install-disclosure');
  assert.ok(disclosure);
  assert.ok(disclosure.dependencies.some(d => d.startsWith('write-file-atomic@')));
  await extConsentHandler.handler({ tempId: disclosure.tempId, approve: true }, ctx);
  assert.ok(replies.find(m => m.type === 'ext-install-done')?.installed);
  assert.ok(!loaded.list.find(e => e.id === 'profiles')?.quarantine);
  console.log(`PASS: host API ${HOST_API_VERSION} accepts aligned manifests, discloses locked dependencies, npm ci --omit=dev and registers Profiles`);
}
console.log('Install runner uses the uncommitted working tree as its clone fixture; remote git installation must be checked after publication.');
