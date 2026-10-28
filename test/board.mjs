import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { spawn, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const core = process.env.AW_CORE_DIR;
assert.ok(core, 'Set AW_CORE_DIR to a merged core checkout with installed dependencies');
const root = fileURLToPath(new URL('..', import.meta.url));
const data = fs.mkdtempSync(path.join(os.tmpdir(), 'profiles-board-'));
const ext = path.join(data, 'extensions', 'profiles');
fs.mkdirSync(ext, { recursive: true });
for (const name of ['index.js', 'store.js', 'package.json', 'package-lock.json', 'public']) fs.cpSync(path.join(root, name), path.join(ext, name), { recursive: true });
execFileSync('npm', ['ci', '--omit=dev', '--ignore-scripts', '--cache', process.env.npm_config_cache || path.join(os.tmpdir(), 'profiles-npm-cache')], { cwd: ext, stdio: 'pipe' });
fs.writeFileSync(path.join(data, 'config.json'), JSON.stringify({ extensions: { profiles: false }, archiveReviewEnabled: false }));
fs.writeFileSync(path.join(data, 'tasks.json'), JSON.stringify({ tasks: [{ id: 'alpha', name: 'Alpha' }, { id: 'beta', name: 'Beta' }, { id: 'gamma', name: 'Gamma' }], order: ['beta', 'adhoc', 'alpha', 'gamma'], assignments: {} }));
const profiles = [{ id: 'first', name: 'Build', taskIds: ['alpha'] }, { id: 'second', name: 'Review', taskIds: ['beta', 'adhoc'] }, { id: 'empty', name: 'Empty', taskIds: [] }, ...Array.from({ length: 15 }, (_, i) => ({ id: `work-${i}`, name: `Workspace ${i + 1}`, taskIds: [] }))];
fs.writeFileSync(path.join(data, 'profiles.json'), JSON.stringify({ revision: 0, profiles }));
fs.mkdirSync(path.join(data, 'claude'), { recursive: true });
fs.mkdirSync(path.join(data, 'codex'), { recursive: true });
const server = net.createServer();
await new Promise(r => server.listen(0, '127.0.0.1', r));
const port = server.address().port;
await new Promise(r => server.close(r));
const url = `http://127.0.0.1:${port}`;
let host, browser, log = '';
const proof = process.env.JOB_EVIDENCE;
const errors = [];
async function shot(page, file) {
  if (!proof) return;
  fs.mkdirSync(proof, { recursive: true });
  await page.screenshot({ path: path.join(proof, file) });
  assert.ok(fs.statSync(path.join(proof, file)).size < 5 * 1024 * 1024);
  console.log(`SHOT ${file} ${url}`);
}
async function eventually(fn, message) {
  const end = Date.now() + 12000;
  while (Date.now() < end) {
    if (await fn()) return;
    await new Promise(r => setTimeout(r, 100));
  }
  throw Error(message);
}
async function frame(page, message) {
  await page.evaluate(async message => {
    const socket = new WebSocket(`${location.origin.replace('http', 'ws')}/ws`);
    await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
    socket.send(JSON.stringify(message));
    await new Promise(resolve => setTimeout(resolve, 200));
    socket.close();
  }, message);
}
const hidden = page => page.evaluate(() => JSON.parse(localStorage.getItem('aw.minimisedTaskIds') || '[]'));
const expectHidden = (page, ids) => eventually(async () => JSON.stringify((await hidden(page)).sort()) === JSON.stringify([...ids].sort()), `Expected minimised ${ids}`);
try {
  host = spawn(process.execPath, [path.join(core, 'server/index.js')], { env: { ...process.env, AW_DATA_DIR: data, AW_PORT: String(port), AW_HOST: '127.0.0.1', AW_DEV: '1', CLAUDE_CONFIG_DIR: path.join(data, 'claude'), CODEX_HOME: path.join(data, 'codex') }, stdio: ['ignore', 'pipe', 'pipe'] });
  host.stdout.on('data', b => { log += b; }); host.stderr.on('data', b => { log += b; });
  await eventually(async () => { try { return (await fetch(url)).ok; } catch { if (host.exitCode != null) throw Error(log); return false; } }, 'Host did not start: ' + log);
  browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_CHANNEL ? { channel: process.env.PLAYWRIGHT_CHANNEL } : {}) });
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  await context.addInitScript(() => { if (!localStorage.getItem('aw.minimisedTaskIds')) localStorage.setItem('aw.minimisedTaskIds', JSON.stringify(['beta'])); });
  const page = await context.newPage();
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(url);
  await page.waitForSelector('.task-cell');
  await frame(page, { type: 'extension-enabled', id: 'profiles', enabled: true });
  await page.waitForSelector('.profiles-cog');
  await expectHidden(page, ['beta']);
  assert.equal(await page.locator('.tray-restore-all').count(), 0);
  assert.equal(await page.locator('.profiles-pill[aria-pressed="true"]').count(), 0);
  const wrap = await page.locator('.profiles-pill').evaluateAll(els => new Set(els.map(el => Math.round(el.getBoundingClientRect().top))).size);
  assert.ok(wrap > 1);
  assert.equal(await page.locator('.profiles-tray > :last-child').getAttribute('aria-label'), 'Manage profiles');
  await shot(page, '01-first-enable.png');
  console.log('PASS first enable preserves beta minimisation, wraps all pills, places cog last and removes core tray');
  await page.getByRole('button', { name: 'Build', exact: true }).click();
  await expectHidden(page, ['beta', 'adhoc', 'gamma']);
  await shot(page, '02-single-profile.png');
  await page.getByRole('button', { name: 'Review', exact: true }).click({ modifiers: ['Shift'] });
  await expectHidden(page, ['gamma']);
  await shot(page, '03-union.png');
  await page.getByRole('button', { name: 'Review', exact: true }).click({ modifiers: ['Shift'] });
  await expectHidden(page, ['beta', 'adhoc', 'gamma']);
  await shot(page, '03-shift-toggle.png');
  await page.getByRole('button', { name: 'Build', exact: true }).click({ modifiers: ['Shift'] });
  await expectHidden(page, []);
  assert.equal(await page.locator('[data-profile="all"]').getAttribute('aria-pressed'), 'true');
  await page.getByRole('button', { name: 'Build', exact: true }).click();
  await page.getByRole('button', { name: 'All', exact: true }).click();
  await expectHidden(page, []);
  await shot(page, '04-all.png');
  await page.getByRole('button', { name: 'Empty', exact: true }).click();
  await expectHidden(page, []);
  assert.equal(await page.locator('[data-profile="all"]').getAttribute('aria-pressed'), 'true');
  await shot(page, '04-empty-selection.png');
  console.log('PASS plain click selects one, Shift-click combines profiles, All and empty profile show all');
  await page.getByRole('button', { name: 'Manage profiles', exact: true }).click();
  await page.waitForSelector('.profiles-dialog');
  assert.deepEqual(await page.locator('.profiles-grid tbody th').allTextContents(), ['Beta', 'Unassigned', 'Alpha', 'Gamma']);
  await page.getByRole('button', { name: '+ New profile', exact: true }).click();
  assert.equal(await page.locator('.profiles-grid tbody td:last-child input:checked').count(), 0);
  await page.locator('.profiles-grid thead input').last().fill('Release');
  await shot(page, '05-new-empty-profile.png');
  await page.locator('[data-task="gamma"] td:last-child input').check();
  await page.locator('.profiles-grid thead input').first().fill('Delivery');
  await page.locator('[data-task="beta"] td').first().locator('input').check();
  await page.getByRole('button', { name: 'Delete profile Workspace 15', exact: true }).click();
  await shot(page, '05-dialog-draft.png');
  await page.locator('.profiles-grid').evaluate(el => { el.scrollLeft = 0; });
  await shot(page, '05-dialog-memberships.png');
  assert.equal(JSON.parse(fs.readFileSync(path.join(data, 'profiles.json'))).revision, 0);
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await page.getByRole('button', { name: 'Manage profiles', exact: true }).click();
  assert.equal(await page.locator('.profiles-grid thead input').first().inputValue(), 'Build');
  await page.getByRole('button', { name: '+ New profile', exact: true }).click();
  await page.locator('.profiles-grid thead input').last().fill('Release');
  await page.locator('[data-task="gamma"] td:last-child input').check();
  await page.locator('.profiles-grid thead input').first().fill('Delivery');
  await page.locator('[data-task="beta"] td').first().locator('input').check();
  await page.getByRole('button', { name: 'Delete profile Workspace 15', exact: true }).click();
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await page.waitForSelector('.profiles-dialog', { state: 'detached' });
  const saved = JSON.parse(fs.readFileSync(path.join(data, 'profiles.json')));
  assert.equal(saved.revision, 1);
  assert.equal(saved.profiles[0].name, 'Delivery');
  assert.deepEqual(saved.profiles[0].taskIds.sort(), ['alpha', 'beta']);
  assert.ok(saved.profiles.some(p => p.name === 'Release' && p.taskIds[0] === 'gamma'));
  assert.ok(!saved.profiles.some(p => p.name === 'Workspace 15'));
  await shot(page, '06-dialog-saved.png');
  console.log('PASS new profiles start empty; rename/delete/membership changes commit in one revision; Cancel discards draft');
  const menuItem = label => page.locator('.context-menu-item').filter({ hasText: label });
  for (const [id, name] of [['alpha', 'Alpha'], ['adhoc', 'Unassigned']]) {
    for (const kind of ['header', 'right-click']) {
      const tile = page.locator(id === 'adhoc' ? '.task-cell[data-entity="no-task"]' : `.task-cell[data-taskid="${id}"]`);
      if (kind === 'header') await tile.locator('.task-actions-btn').click();
      else await tile.locator('.task-name').click({ button: 'right' });
      assert.equal(await menuItem('Focus').count(), kind === 'header' ? 1 : 0);
      assert.equal(await menuItem('Minimise').count(), 0);
      await shot(page, `07-${id}-${kind}-menu.png`);
      await menuItem('Manage profiles…').click();
      assert.equal(await page.locator('.profiles-highlight th').textContent(), name);
      await shot(page, `08-${id}-${kind}-dialog.png`);
      await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    }
  }
  await page.locator('#grid').dispatchEvent('contextmenu', { clientX: 650, clientY: 650 });
  assert.equal(await menuItem('New task').count(), 1);
  await shot(page, '09-blank-menu.png');
  await menuItem('Manage profiles…').click();
  assert.equal(await page.locator('.profiles-highlight').count(), 0);
  await shot(page, '10-blank-dialog.png');
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  console.log('PASS both task menus highlight Alpha/Unassigned; header retains Focus; core right-click menu has no Focus; blank menu retains New task and opens without highlight');

  const secondContext = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const second = await secondContext.newPage();
  second.on('pageerror', e => errors.push(e.message));
  await second.goto(url); await second.waitForSelector('.profiles-cog');
  assert.equal(await second.getByRole('button', { name: 'Release', exact: true }).count(), 1);
  await page.getByRole('button', { name: 'Delivery', exact: true }).click();
  await expectHidden(page, ['adhoc', 'gamma']);
  await second.getByRole('button', { name: 'Review', exact: true }).click();
  await expectHidden(second, ['alpha', 'gamma']);
  await shot(page, '11-browser-a.png'); await shot(second, '12-browser-b.png');
  await page.reload(); await page.waitForSelector('.profiles-cog');
  await expectHidden(page, ['adhoc', 'gamma']);
  assert.equal(await page.locator('[data-profile="first"]').getAttribute('aria-pressed'), 'true');
  console.log('PASS browsers share saved profiles, keep independent selections and restore matching selection after reload');

  await page.getByRole('button', { name: 'Manage profiles', exact: true }).click();
  await page.locator('[data-task="gamma"] td').first().locator('input').check();
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await page.waitForSelector('.profiles-dialog', { state: 'detached' });
  await expectHidden(page, ['adhoc']);
  await expectHidden(second, ['alpha', 'gamma']);
  await shot(page, '13-membership-applied.png');
  console.log('PASS editing selected membership applies an atomic switch without changing the other browser selection');

  await frame(page, { type: 'task-create', name: 'New arrival' });
  await page.getByText('New arrival', { exact: true }).waitFor();
  const newId = JSON.parse(fs.readFileSync(path.join(data, 'tasks.json'))).tasks.find(t => t.name === 'New arrival').id;
  assert.ok(!(await hidden(page)).includes(newId));
  assert.equal(await page.locator('.profiles-pill[aria-pressed="true"]').count(), 0);
  await shot(page, '14-new-task.png');
  await page.getByRole('button', { name: 'Delivery', exact: true }).click();
  await page.locator('.task-cell[data-taskid="beta"] .task-actions-btn').click();
  await menuItem('Focus').click();
  await expectHidden(page, ['alpha', 'adhoc', 'gamma', newId]);
  assert.equal(await page.locator('.profiles-pill[aria-pressed="true"]').count(), 0);
  await shot(page, '15-core-focus.png');
  console.log('PASS new task appears without membership; core Focus clears stale profile pill');
  await page.getByRole('button', { name: 'All', exact: true }).click();
  await frame(page, { type: 'task-archive', taskId: 'alpha' });
  await eventually(() => !JSON.parse(fs.readFileSync(path.join(data, 'profiles.json'))).profiles.some(p => p.taskIds.includes('alpha')), 'Archived membership persisted');
  await frame(page, { type: 'task-delete', taskId: 'gamma' });
  await eventually(() => !JSON.parse(fs.readFileSync(path.join(data, 'profiles.json'))).profiles.some(p => p.taskIds.includes('gamma')), 'Deleted membership persisted');
  await page.getByRole('button', { name: 'Manage profiles', exact: true }).click();
  assert.deepEqual(await page.locator('.profiles-grid tbody th').allTextContents(), ['Beta', 'Unassigned', 'New arrival']);
  await shot(page, '16-housekeeping.png');
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await page.getByRole('button', { name: 'Release', exact: true }).click();
  await expectHidden(page, []);
  assert.equal(await page.locator('[data-profile="all"]').getAttribute('aria-pressed'), 'true');
  console.log('PASS archive/delete removes durable membership; empty selected profile shows every live task');

  await page.getByRole('button', { name: 'Review', exact: true }).click();
  const beforeDisable = await hidden(page);
  await page.getByRole('button', { name: 'Manage profiles', exact: true }).click();
  await frame(page, { type: 'extension-enabled', id: 'profiles', enabled: false });
  await page.waitForSelector('.profiles-cog', { state: 'detached' });
  assert.equal(await page.locator('.profiles-dialog').count(), 0);
  await expectHidden(page, beforeDisable);
  await page.locator('.task-cell[data-taskid="beta"] .task-actions-btn').click();
  assert.equal(await menuItem('Minimise').count(), 1);
  await page.keyboard.press('Escape');
  await shot(page, '17-disabled-core-tray.png');
  await frame(page, { type: 'extension-enabled', id: 'profiles', enabled: true });
  await page.waitForSelector('.profiles-cog');
  await expectHidden(page, beforeDisable);
  console.log('PASS disable closes dialog, restores core tray/Minimise and preserves view; re-enable preserves view');
  assert.deepEqual(errors, []);
} catch (error) {
  console.error(log.slice(-4000));
  throw error;
} finally {
  await browser?.close();
  if (host && host.exitCode == null) {
    host.kill('SIGTERM');
    await Promise.race([new Promise(r => host.once('exit', r)), new Promise(r => setTimeout(r, 3000))]);
    if (host.exitCode == null) { host.kill('SIGKILL'); await new Promise(r => host.once('exit', r)); }
  }
  fs.rmSync(data, { recursive: true, force: true });
  console.log('CLEANUP temporary browsers and host stopped');
}
