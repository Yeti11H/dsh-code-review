import { lstat, mkdir, readFile, readdir, rename, rm, rmdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { Learning, ReviewSession } from '../types.js';

export class StorageService {
  readonly directory: string;
  constructor(private readonly repository: string) { this.directory = path.join(repository, '.dsh-review'); }

  private validateId(id: string): void {
    if (!/^RV-[a-f0-9-]{36}$/.test(id)) throw new Error('Invalid review session ID');
  }

  private async prepare(): Promise<void> {
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    if ((await lstat(this.directory)).isSymbolicLink()) throw new Error('Review storage must not be a symlink');
  }

  async write(name: string, data: string): Promise<void> {
    if (!/^RV-[a-f0-9-]{36}\.(json|md)$/.test(name) && name !== 'learnings.json') throw new Error('Invalid storage filename');
    await this.prepare();
    const temp = path.join(this.directory, `.${randomUUID()}.tmp`);
    try {
      await writeFile(temp, data, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
      await rename(temp, path.join(this.directory, name));
    } finally { await rm(temp, { force: true }); }
  }

  async saveSession(session: ReviewSession): Promise<void> {
    this.validateId(session.id);
    await this.write(`${session.id}.json`, JSON.stringify(session, null, 2));
  }

  async loadSession(id: string): Promise<ReviewSession> {
    this.validateId(id);
    await this.prepare();
    const file = path.join(this.directory, `${id}.json`);
    const stat = await lstat(file);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 250_000_000) throw new Error('Invalid session file');
    const session: ReviewSession = JSON.parse(await readFile(file, 'utf8'));
    if (session.schemaVersion !== 1 || session.id !== id || session.repository !== this.repository
      || !Array.isArray(session.rounds) || !Array.isArray(session.calls) || !session.context || !session.snapshot) {
      throw new Error('Invalid or incompatible review session');
    }
    return session;
  }

  async listSessions(): Promise<Array<{ id: string; status: string; rounds: number; createdAt: number }>> {
    await this.prepare();
    const sessions = [];
    for (const file of (await readdir(this.directory)).filter(f => /^RV-[a-f0-9-]{36}\.json$/.test(f))) {
      const session = await this.loadSession(file.slice(0, -5));
      sessions.push({ id: session.id, status: session.status, rounds: session.rounds.length, createdAt: session.createdAt });
    }
    return sessions.sort((a, b) => b.createdAt - a.createdAt);
  }

  async loadLearnings(): Promise<Learning[]> {
    await this.prepare();
    const file = path.join(this.directory, 'learnings.json');
    try {
      const stat = await lstat(file);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 500_000) throw new Error('Invalid feedback file');
      const value = JSON.parse(await readFile(file, 'utf8'));
      if (!Array.isArray(value.learnings) || value.learnings.length > 100 || value.learnings.some((l: Learning) => !l
        || !['false_positive', 'wont_fix'].includes(l.action) || typeof l.file !== 'string' || typeof l.codePattern !== 'string'
        || !l.codePattern.trim() || l.codePattern.length > 300 || typeof l.reason !== 'string' || l.reason.length > 2000
        || typeof l.contextHash !== 'string' || typeof l.sessionId !== 'string' || typeof l.issueId !== 'string')) throw new Error('Invalid feedback data');
      return value.learnings;
    } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []; throw error; }
  }

  async saveLearnings(learnings: Learning[]): Promise<void> {
    await this.write('learnings.json', JSON.stringify({ learnings: learnings.slice(-100) }, null, 2));
  }

  async withLock<T>(operation: () => Promise<T>): Promise<T> {
    await this.prepare();
    const lock = path.join(this.directory, '.lock');
    try { await mkdir(lock); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') throw new Error('Another review is running. If a process crashed, remove .dsh-review/.lock after confirming it stopped.');
      throw error;
    }
    try { return await operation(); }
    finally { await rmdir(lock); }
  }
}
