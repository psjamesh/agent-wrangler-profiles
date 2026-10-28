const SETTINGS_ICON = '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/></svg>';

function node(tag, text, className) {
  const el = document.createElement(tag);
  if (text != null) el.textContent = text;
  if (className) el.className = className;
  return el;
}
function button(text, run, className) {
  const el = node('button', text, className);
  el.type = 'button';
  el.addEventListener('click', run);
  return el;
}
const sameIds = (a, b) => a.length === b.length && a.every(id => b.includes(id));

export default {
  register(slots) {
    const api = slots.api;
    let selected;
    try {
      const saved = JSON.parse(api.storage.get('selection'));
      selected = Array.isArray(saved) ? saved.filter(id => typeof id === 'string') : [];
    } catch { selected = []; }
    let refreshDialog, taskSignature;
    let host, ctx, state = { revision: 0, profiles: [] }, initialized = false, modal = null, priorFocus, pending, saveTimer;

    function remember() { api.storage.set('selection', JSON.stringify(selected)); }
    function membership(profiles) {
      return JSON.stringify(profiles.filter(p => selected.includes(p.id)).map(p => [p.id, [...p.taskIds].sort()]));
    }
    function target() {
      const visible = new Set(state.profiles.filter(p => selected.includes(p.id)).flatMap(p => p.taskIds));
      if (!ctx.tasks.some(t => visible.has(t.id))) { selected = []; remember(); return []; }
      return selected.length ? ctx.tasks.filter(t => !visible.has(t.id)).map(t => t.id) : [];
    }
    function apply() {
      const ids = selected.length ? target() : [];
      remember();
      if (api.setMinimisedTasks(ids)) ctx = { ...ctx, minimisedIds: ids };
      else { selected = []; remember(); }
      draw();
    }
    function choose(id, shift) {
      if (id === 'all') selected = [];
      else if (shift) selected = selected.includes(id) ? selected.filter(x => x !== id) : [...selected, id];
      else selected = [id];
      apply();
    }
    function draw() {
      if (!host) return;
      const focused = document.activeElement?.dataset.profile;
      const cogFocused = document.activeElement?.classList.contains('profiles-cog');
      host.replaceChildren();
      for (const p of [{ id: 'all', name: 'All' }, ...state.profiles]) {
        const pill = button(p.name, e => choose(p.id, e.shiftKey), 'profiles-pill');
        pill.dataset.profile = p.id;
        pill.setAttribute('aria-pressed', String(p.id === 'all' ? selected.length === 0 && ctx.minimisedIds.length === 0 : selected.includes(p.id)));
        host.append(pill);
      }
      const cog = button(null, () => open(), 'profiles-cog');
      cog.innerHTML = SETTINGS_ICON;
      cog.title = 'Manage profiles';
      cog.setAttribute('aria-label', 'Manage profiles');
      host.append(cog);
      if (cogFocused) cog.focus();
      if (focused) [...host.children].find(el => el.dataset.profile === focused)?.focus();
    }
    function close() {
      clearTimeout(saveTimer);
      pending = null;
      modal?.remove();
      modal = null;
      refreshDialog = null;
      (priorFocus?.isConnected ? priorFocus : host?.querySelector('.profiles-cog'))?.focus();
    }
    function open(taskId) {
      close();
      priorFocus = document.activeElement;
      const draft = structuredClone(state);
      modal = node('dialog', null, 'profiles-dialog');
      modal.setAttribute('role', 'dialog');
      modal.setAttribute('aria-modal', 'true');
      modal.setAttribute('aria-labelledby', 'profiles-title');
      const title = node('h2', 'Manage profiles');
      title.id = 'profiles-title';
      const note = node('p', 'Choose the tasks in each profile. Changes apply together when you save.', 'profiles-note');
      const grid = node('div', null, 'profiles-grid');
      const error = node('p', '', 'profiles-error');
      error.setAttribute('role', 'alert');
      const actions = node('div', null, 'profiles-actions');
      let saving = false;
      function lock(on) {
        saving = on;
        modal.querySelectorAll('button, input').forEach(el => { el.disabled = on; });
        save.textContent = on ? 'Saving…' : 'Save';
      }
      function renderGrid() {
        grid.replaceChildren();
        const table = node('table');
        const head = node('thead'), headings = node('tr');
        const corner = node('th', 'Task');
        corner.scope = 'col';
        headings.append(corner);
        for (const p of draft.profiles) {
          const th = node('th');
          th.scope = 'col';
          const input = node('input');
          input.type = 'text'; input.maxLength = 100; input.value = p.name;
          input.setAttribute('aria-label', `Profile name: ${p.name}`);
          input.addEventListener('input', () => { p.name = input.value; });
          const remove = button('Delete', () => { draft.profiles = draft.profiles.filter(x => x.id !== p.id); renderGrid(); }, 'ghost profiles-delete');
          remove.setAttribute('aria-label', `Delete profile ${p.name}`);
          th.append(input, remove); headings.append(th);
        }
        head.append(headings); table.append(head);
        const body = node('tbody');
        for (const t of ctx.tasks) {
          const row = node('tr'); row.dataset.task = t.id;
          if (t.id === taskId) row.className = 'profiles-highlight';
          const label = node('th', t.name); label.scope = 'row'; row.append(label);
          for (const p of draft.profiles) {
            const cell = node('td'), input = node('input');
            input.type = 'checkbox'; input.checked = p.taskIds.includes(t.id);
            input.setAttribute('aria-label', `${t.name} in ${p.name}`);
            input.addEventListener('change', () => { p.taskIds = input.checked ? [...p.taskIds, t.id] : p.taskIds.filter(id => id !== t.id); });
            cell.append(input); row.append(cell);
          }
          body.append(row);
        }
        table.append(body); grid.append(table);
        if (!draft.profiles.length) grid.append(node('p', 'No profiles yet. Add a profile to start.', 'profiles-note'));
        grid.querySelectorAll('button, input').forEach(el => { el.disabled = saving; });
      }
      const add = button('+ New profile', () => {
        if (draft.profiles.length >= 200) { error.textContent = 'Use at most 200 profiles.'; return; }
        draft.profiles.push({ id: crypto.randomUUID(), name: 'New profile', taskIds: [] });
        renderGrid();
        const inputs = grid.querySelectorAll('thead input');
        inputs[inputs.length - 1].focus(); inputs[inputs.length - 1].select();
      }, 'ghost');
      add.dataset.action = 'add';
      const cancel = button('Cancel', () => { if (!saving) close(); }, 'ghost');
      cancel.dataset.action = 'cancel';
      const save = button('Save', () => {
        if (draft.profiles.some(p => !p.name.trim())) { error.textContent = 'Give every profile a name.'; return; }
        error.textContent = '';
        pending = { requestId: crypto.randomUUID(), error, lock };
        lock(true);
        api.send({ type: 'profiles-save', requestId: pending.requestId, revision: draft.revision, profiles: draft.profiles });
        saveTimer = setTimeout(() => {
          if (!pending) return;
          pending = null; lock(false);
          error.textContent = 'No response received. Cancel and reopen to check whether the save completed.';
        }, 15000);
      }, 'primary');
      save.dataset.action = 'save';
      actions.append(add, node('span', null, 'profiles-spacer'), cancel, save);
      modal.append(title, note, grid, error, actions);
      modal.addEventListener('cancel', e => { e.preventDefault(); if (!saving) close(); });
      modal.addEventListener('keydown', e => {
        e.stopPropagation();
        if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); if (!saving) close(); }
      });
      refreshDialog = renderGrid;
      renderGrid(); document.body.append(modal);
      if (modal.showModal) modal.showModal(); else modal.setAttribute('open', '');
      const opened = modal;
      requestAnimationFrame(() => {
        if (modal !== opened) return;
        modal.querySelector('.profiles-highlight')?.scrollIntoView({ block: 'center' });
      });
      cancel.focus();
    }
    api.onMessage(msg => {
      if (!pending || msg.kind !== 'saved' || msg.requestId !== pending.requestId) return;
      clearTimeout(saveTimer);
      if (msg.ok) close();
      else { pending.error.textContent = msg.error || 'Could not save profiles.'; pending.lock(false); pending = null; }
    });
    slots.register('board.tray', {
      id: 'profiles',
      mount(el, _api, context) { host = el; host.classList.add('profiles-tray'); ctx = context; },
      update(el, context, graph) {
        ctx = context;
        const signature = JSON.stringify(ctx.tasks);
        if (signature !== taskSignature) refreshDialog?.();
        taskSignature = signature;
        const next = graph.profiles;
        if (!next) return;
        const hadSelection = selected.length > 0;
        const oldMembership = membership(state.profiles);
        const newMembership = membership(next.profiles);
        state = next;
        selected = selected.filter(id => state.profiles.some(p => p.id === id));
        if (initialized && oldMembership !== newMembership && hadSelection) {
          apply();
        } else if (selected.length) {
          const ids = target();
          if (!sameIds(ids, ctx.minimisedIds)) selected = [];
        }
        initialized = true; remember(); draw();
      },
      unmount() { close(); host?.replaceChildren(); host = null; initialized = false; },
      minimiseItem(task) { return { label: 'Manage profiles…', icon: SETTINGS_ICON, run: () => open(task.id) }; },
      backgroundItem() { return { label: 'Manage profiles…', icon: SETTINGS_ICON, run: () => open() }; },
    });
  },
};
