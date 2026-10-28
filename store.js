import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import writeFileAtomic from 'write-file-atomic';

function validate(profiles) {
  if (!Array.isArray(profiles) || profiles.length > 200) throw Error('Use at most 200 profiles.');
  const ids = new Set();
  return profiles.map(p => {
    if (!p || typeof p.id !== 'string' || !/^[a-zA-Z0-9-]{1,80}$/.test(p.id) || ids.has(p.id)) throw Error('Invalid or duplicate profile id.');
    ids.add(p.id);
    if (typeof p.name !== 'string' || !p.name.trim() || p.name.trim().length > 100) throw Error('Each profile needs a name of 1–100 characters.');
    if (!Array.isArray(p.taskIds) || p.taskIds.length > 1000 || p.taskIds.some(id => typeof id !== 'string' || !id)) throw Error('Invalid task membership.');
    return { id: p.id, name: p.name.trim(), taskIds: [...new Set(p.taskIds)] };
  });
}

export function dataFile() {
  const configured = process.env.AW_DATA_DIR;
  const base = configured === '~' ? os.homedir() : configured?.startsWith('~/') ? path.join(os.homedir(), configured.slice(2)) : configured || path.join(os.homedir(), '.agent-wrangler');
  return path.resolve(base, 'profiles.json');
}

export class ProfilesStore {
  constructor(file = dataFile()) {
    this.file = file;
    this.state = { revision: 0, profiles: [] };
    try {
      const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (!Number.isSafeInteger(saved.revision) || saved.revision < 0) throw Error('Invalid profiles revision.');
      this.state = { revision: saved.revision, profiles: validate(saved.profiles) };
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }

  snapshot() { return structuredClone(this.state); }

  commit(profiles) {
    const next = { revision: this.state.revision + 1, profiles };
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    writeFileAtomic.sync(this.file, JSON.stringify(next, null, 2) + '\n', { mode: 0o600 });
    this.state = next;
  }

  save(profiles, revision, liveIds) {
    if (revision !== this.state.revision) throw Error('Profiles changed in another browser. Cancel and reopen to load the latest profiles.');
    const next = validate(profiles).map(p => ({ ...p, taskIds: p.taskIds.filter(id => liveIds.has(id)) }));
    this.commit(next);
  }

  prune(liveIds) {
    const next = this.state.profiles.map(p => ({ ...p, taskIds: p.taskIds.filter(id => liveIds.has(id)) }));
    if (JSON.stringify(next) === JSON.stringify(this.state.profiles)) return false;
    this.commit(next);
    return true;
  }

  deleteTask(taskId) {
    const next = this.state.profiles.map(p => ({ ...p, taskIds: p.taskIds.filter(id => id !== taskId) }));
    if (JSON.stringify(next) !== JSON.stringify(this.state.profiles)) this.commit(next);
  }
}
