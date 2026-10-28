import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ProfilesStore } from './store.js';

export const dir = path.dirname(fileURLToPath(import.meta.url));
const liveIds = host => new Set([host.tasks.adhocId, ...host.tasks.list().filter(t => !t.archived).map(t => t.taskId)]);

export default {
  id: 'profiles',
  label: 'Profiles',
  description: 'Save named sets of tasks and switch the board between them.',
  author: 'Profiles contributors',
  help: 'Shared named sets of tasks, with a separate selection in each browser. Turning Profiles off keeps saved profiles and the current minimised tasks.',
  dir,
  defaultEnabled: true,
  requires: ['tasks:read', 'board:rebuild', 'board:broadcast'],
  engines: { wranglerApi: '^1.53.0' },
  stores: { profiles: () => new ProfilesStore() },
  handlers: [{
    type: 'profiles-save',
    async handler(msg, host) {
      if (typeof msg.requestId !== 'string' || msg.requestId.length > 100) return;
      try {
        host.stores.profiles.save(msg.profiles, msg.revision, liveIds(host));
      } catch (error) {
        host.broadcast({ kind: 'saved', requestId: msg.requestId, ok: false, error: error.message });
        return;
      }
      await host.rebuild();
      host.broadcast({ kind: 'saved', requestId: msg.requestId, ok: true });
    },
  }],
  graph({ host }) {
    const store = host.stores.profiles;
    store.prune(liveIds(host));
    return { profiles: store.snapshot() };
  },
  onTaskDelete({ taskId, host }) { host.stores.profiles.deleteTask(taskId); },
  client: 'public/client.js',
  styles: 'public/styles.css',
};
