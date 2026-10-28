import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import client from '../public/client.js';

function setup(t, { stored = [], minimisedIds = [] } = {}) {
  const dom = new JSDOM('<div id="tray"></div>', { url: 'http://localhost' });
  globalThis.document = dom.window.document;
  globalThis.requestAnimationFrame = fn => { fn(); return 1; };
  dom.window.HTMLElement.prototype.scrollIntoView = function () {};
  t.after(() => { tray?.unmount(); dom.window.close(); });
  const calls = [], sent = [], storage = new Map([['selection', JSON.stringify(stored)]]);
  let tray, receive;
  const api = {
    storage: { get: k => storage.get(k), set: (k, v) => storage.set(k, v) },
    send: m => sent.push(m), onMessage: fn => { receive = fn; },
    setMinimisedTasks: ids => { calls.push(ids); ctx.minimisedIds = [...ids]; return true; },
  };
  const ctx = { tasks: [{ id: 'a', name: 'Alpha' }, { id: 'adhoc', name: 'Unassigned', adhoc: true }, { id: 'b', name: 'Beta' }], minimisedIds };
  const graph = { profiles: { revision: 1, profiles: [{ id: 'one', name: 'First', taskIds: ['a'] }, { id: 'two', name: 'Second', taskIds: ['b'] }, { id: 'empty', name: 'Empty', taskIds: [] }] } };
  client.register({ api, register: (slot, value) => { assert.equal(slot, 'board.tray'); tray = value; } });
  const el = document.querySelector('#tray');
  tray.mount(el, api, ctx);
  tray.update(el, ctx, graph);
  const update = () => tray.update(el, ctx, graph);
  const click = (name, shiftKey = false) => [...el.querySelectorAll('button')].find(b => b.textContent === name).dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, shiftKey }));
  return { el, ctx, graph, tray, calls, sent, storage, update, click, receive: m => receive(m) };
}

test('first mount preserves minimisation and has neither All nor profiles selected', t => {
  const s = setup(t, { minimisedIds: ['b'], stored: ['one'] });
  assert.deepEqual(s.calls, []);
  assert.equal(s.el.querySelectorAll('[aria-pressed="true"]').length, 0);
  assert.equal(s.el.lastElementChild.getAttribute('aria-label'), 'Manage profiles');
});

test('plain click, Shift union/toggle, All and empty selection are atomic', t => {
  const s = setup(t);
  s.click('First');
  assert.deepEqual(s.calls.at(-1), ['adhoc', 'b']);
  s.click('First');
  assert.equal(s.el.querySelector('[data-profile="one"]').getAttribute('aria-pressed'), 'true');
  s.click('Second', true);
  assert.deepEqual(s.calls.at(-1), ['adhoc']);
  s.click('First', true);
  assert.deepEqual(s.calls.at(-1), ['a', 'adhoc']);
  s.click('Second', true);
  assert.deepEqual(s.calls.at(-1), []);
  s.click('Empty');
  assert.deepEqual(s.calls.at(-1), []);
  assert.equal(s.el.querySelector('[data-profile="all"]').getAttribute('aria-pressed'), 'true');
  s.click('First'); s.click('All');
  assert.deepEqual(s.calls.at(-1), []);
});

test('core changes clear stale selection; new tasks stay visible; selected membership edits recompute', t => {
  const s = setup(t);
  s.click('First');
  s.ctx.minimisedIds = ['a', 'b'];
  s.update();
  assert.deepEqual(JSON.parse(s.storage.get('selection')), []);
  s.click('First');
  s.ctx.tasks.push({ id: 'new', name: 'New' });
  const before = s.calls.length;
  s.update();
  assert.equal(s.calls.length, before);
  assert.ok(!s.ctx.minimisedIds.includes('new'));
  assert.deepEqual(JSON.parse(s.storage.get('selection')), []);
  s.click('First');
  s.graph.profiles = structuredClone(s.graph.profiles);
  s.graph.profiles.profiles[0].taskIds.push('b');
  s.graph.profiles.revision++;
  s.update();
  assert.deepEqual(s.calls.at(-1), ['adhoc', 'new']);
});

test('menu targets ordered task rows; Cancel discards all changes and unmount closes dialog', t => {
  const s = setup(t);
  s.tray.minimiseItem(s.ctx.tasks[1]).run();
  assert.deepEqual([...document.querySelectorAll('tbody th')].map(e => e.textContent), ['Alpha', 'Unassigned', 'Beta']);
  assert.equal(document.querySelector('.profiles-highlight th').textContent, 'Unassigned');
  document.querySelector('[data-action="add"]').click();
  const inputs = document.querySelectorAll('thead input');
  assert.equal(inputs.length, 4);
  assert.equal(document.querySelectorAll('tbody td:last-child input:checked').length, 0);
  inputs[0].value = 'Changed';
  document.querySelector('tbody input').click();
  document.querySelector('[data-action="cancel"]').click();
  assert.equal(s.sent.length, 0);
  s.tray.backgroundItem().run();
  assert.equal(document.querySelectorAll('.profiles-highlight').length, 0);
  assert.equal(document.querySelector('thead input').value, 'First');
  s.tray.unmount();
  assert.equal(document.querySelector('[role="dialog"]'), null);
});

test('Save sends one transaction and waits for the matching success; errors keep draft', t => {
  const s = setup(t);
  s.tray.backgroundItem().run();
  document.querySelector('thead input').value = 'Renamed';
  document.querySelector('thead input').dispatchEvent(new document.defaultView.Event('input')); 
  document.querySelector('tbody input').click();
  document.querySelector('[data-action="save"]').click();
  assert.equal(s.sent.length, 1);
  assert.equal(s.sent[0].profiles[0].name, 'Renamed');
  assert.deepEqual(s.sent[0].profiles[0].taskIds, []);
  s.receive({ kind: 'saved', requestId: 'elsewhere', ok: true });
  assert.ok(document.querySelector('[role="dialog"]'));
  s.receive({ kind: 'saved', requestId: s.sent[0].requestId, ok: false, error: 'Profiles changed' });
  assert.match(document.querySelector('[role="alert"]').textContent, /Profiles changed/);
  document.querySelector('[data-action="save"]').click();
  s.receive({ kind: 'saved', requestId: s.sent[1].requestId, ok: true });
  assert.equal(document.querySelector('[role="dialog"]'), null);
});

test('deleting the selected profile restores All in one operation', t => {
  const s = setup(t);
  s.click('First');
  s.graph.profiles = { revision: 2, profiles: s.graph.profiles.profiles.filter(p => p.id !== 'one') };
  s.update();
  assert.deepEqual(s.calls.at(-1), []);
  assert.equal(s.el.querySelector('[data-profile="all"]').getAttribute('aria-pressed'), 'true');
});

test('open grid follows live task ordering and excludes removed tasks without losing draft names', t => {
  const s = setup(t);
  s.tray.backgroundItem().run();
  const input = document.querySelector('thead input');
  input.value = 'Draft'; input.dispatchEvent(new document.defaultView.Event('input'));
  s.ctx.tasks = [s.ctx.tasks[2], s.ctx.tasks[1], { id: 'new', name: 'New' }];
  s.update();
  assert.deepEqual([...document.querySelectorAll('tbody th')].map(el => el.textContent), ['Beta', 'Unassigned', 'New']);
  assert.equal(document.querySelector('thead input').value, 'Draft');
});

test('first use always offers All and the cog; a new profile saves empty without selecting it', t => {
  const s = setup(t);
  s.graph.profiles = { revision: 0, profiles: [] };
  s.update();
  assert.equal(s.el.querySelectorAll('button').length, 2);
  assert.equal(s.el.querySelector('[data-profile="all"]').getAttribute('aria-pressed'), 'true');
  s.tray.backgroundItem().run();
  document.querySelector('[data-action="add"]').click();
  document.querySelector('[data-action="save"]').click();
  assert.deepEqual(s.sent[0].profiles[0].taskIds, []);
  assert.deepEqual(s.calls, []);
});
