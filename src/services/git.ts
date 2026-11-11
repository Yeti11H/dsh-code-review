import { createHash } from 'node:crypto';
import { readFile, realpath, lstat } from 'node:fs/promises';
import path from 'node:path';
import type { ChangeSnapshot, FileChange, ReviewOptions } from '../types.js';
import { runProcess } from './process.js';

export function calculateHash(content: string): string {
  return createHash('sha256').update(content).digest('hex');
}

export function sourceAllowed(file: string): boolean {
  return !/(^|\/)(\.git|\.dsh-review|node_modules|vendor|dist|build|coverage)(\/|$)/i.test(file)
    && !/(^|\/)(\.env(?:\..*)?|.*\.(pem|key|p12|pfx)|id_rsa|credentials(?:\..*)?)$/i.test(file);
}

export class GitService {
  constructor(public readonly cwd: string, private readonly options: ReviewOptions = {}) {}

  private async git(args: string[], signal?: AbortSignal): Promise<string> {
    const r = await runProcess('git', ['--no-pager', '-c', 'core.quotepath=false', ...args], this.cwd, signal);
    if (r.exitCode !== 0) throw new Error(`Git failed: ${r.stderr.trim() || r.stdout.trim()}`);
    return r.stdout;
  }

  async root(signal?: AbortSignal): Promise<string> {
    return realpath((await this.git(['rev-parse', '--show-toplevel'], signal)).trim());
  }

  async resolveCommit(ref: string, signal?: AbortSignal): Promise<string> {
    if (!ref || ref.startsWith('-') || /[\x00-\x1f]/.test(ref)) throw new Error('Invalid Git reference');
    return (await this.git(['rev-parse', '--verify', '--end-of-options', `${ref}^{commit}`], signal)).trim();
  }

  private async readWorking(root: string, file: string): Promise<string | undefined> {
    const absolute = path.resolve(root, file);
    const relative = path.relative(root, absolute);
    if (relative.startsWith('..') || path.isAbsolute(relative)) return undefined;
    try {
      const stat = await lstat(absolute);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size > (this.options.maxFileBytes ?? 512_000)) return undefined;
      const resolved = await realpath(absolute);
      const actualRelative = path.relative(root, resolved);
      if (actualRelative.startsWith('..') || path.isAbsolute(actualRelative)) return undefined;
      const bytes = await readFile(absolute);
      if (bytes.includes(0) || bytes.length > (this.options.maxFileBytes ?? 512_000)) return undefined;
      return bytes.toString('utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
      throw error;
    }
  }

  private async readCommitted(commit: string, file: string, signal?: AbortSignal): Promise<string | undefined> {
    const size = await runProcess('git', ['cat-file', '-s', `${commit}:${file}`], this.cwd, signal);
    if (size.exitCode !== 0 || Number(size.stdout) > (this.options.maxFileBytes ?? 512_000)) return undefined;
    const mode = await this.git(['ls-tree', commit, '--', file], signal);
    if (!mode.startsWith('100')) return undefined;
    const text = await this.git(['show', `${commit}:${file}`], signal);
    return text.includes('\0') ? undefined : text;
  }

  async getChanges(target = 'unstaged', signal?: AbortSignal): Promise<ChangeSnapshot> {
    const root = await this.root(signal);
    if (path.resolve(root).toLowerCase() !== path.resolve(this.cwd).toLowerCase()) {
      return new GitService(root, this.options).getChanges(target, signal);
    }
    const working = target === 'unstaged' || target === 'working';
    const head = await this.resolveCommit('HEAD', signal);
    const base = working ? head : (await this.git(['merge-base', await this.resolveCommit(target, signal), head], signal)).trim();
    const range = working ? [base] : [base, head];
    const names = (await this.git(['diff', '--name-status', '-z', '--no-renames', ...range, '--', '.'], signal)).split('\0');
    const changes = new Map<string, string>();
    for (let i = 0; i < names.length - 1; i += 2) if (names[i + 1]) changes.set(names[i + 1]!, names[i]!);
    const tracked = (await this.git(working ? ['ls-files', '-z'] : ['ls-tree', '-r', '--name-only', '-z', head], signal)).split('\0').filter(Boolean);
    const untracked = working ? (await this.git(['ls-files', '--others', '--exclude-standard', '-z'], signal)).split('\0').filter(Boolean) : [];
    for (const file of untracked) changes.set(file, 'A');
    const sources: Record<string, string> = Object.create(null);
    const before: Record<string, string> = Object.create(null);
    const omissions: string[] = [];
    let used = 0;
    const priority = [...changes.keys(), ...tracked, ...untracked];
    for (const file of new Set(priority)) {
      signal?.throwIfAborted();
      if (!sourceAllowed(file)) {
        if (changes.has(file) && !file.startsWith('.dsh-review/')) omissions.push(`${file}: excluded by source policy`);
        continue;
      }
      if (Object.keys(sources).length >= (this.options.maxSourceFiles ?? 2000)) { omissions.push(`${file}: source-file limit`); continue; }
      const text = working ? await this.readWorking(root, file) : await this.readCommitted(head, file, signal);
      if (text === undefined) {
        if (changes.get(file) !== 'D') omissions.push(`${file}: binary, symlink, absent or oversized`);
        continue;
      }
      const size = Buffer.byteLength(text);
      if (used + size > (this.options.maxSnapshotBytes ?? 20_000_000)) { omissions.push(`${file}: snapshot byte limit`); continue; }
      used += size;
      sources[file] = text;
    }
    const files: FileChange[] = [];
    for (const [file, status] of changes) {
      if (!sourceAllowed(file)) continue;
      if (file.length > 4096) { omissions.push(`${file.slice(0, 100)}: path too long`); continue; }
      if (status !== 'D' && sources[file] === undefined) continue;
      const old = await this.readCommitted(base, file, signal);
      if (old !== undefined) before[file] = old;
      if (status === 'D' && old === undefined) { omissions.push(`${file}: deleted file unavailable`); continue; }
      let diff: string;
      if (untracked.includes(file)) {
        const lines = sources[file]!.split('\n');
        diff = `diff --git a/${file} b/${file}\n--- /dev/null\n+++ b/${file}\n@@ -0,0 +1,${lines.length} @@\n${lines.map(l => '+' + l).join('\n')}\n`;
      } else {
        diff = await this.git(['diff', '--no-ext-diff', '--no-textconv', '--no-renames', '--unified=3', ...range, '--', file], signal);
      }
      if (/^Binary files /m.test(diff)) { omissions.push(`${file}: binary diff`); continue; }
      files.push({ file, status, diff, linesChanged: countChanged(diff) });
    }
    const snapshot: ChangeSnapshot = { hash: '', target, base, head, files, sources, before, omissions, timestamp: Date.now() };
    snapshot.hash = calculateHash(JSON.stringify({ target, base, head, files,
      sources: Object.entries(sources).sort(([a], [b]) => a.localeCompare(b)),
      before: Object.entries(before).sort(([a], [b]) => a.localeCompare(b)), omissions: [...omissions].sort() }));
    return snapshot;
  }

  splitLargeChanges(files: FileChange[]): FileChange[][] {
    const limit = this.options.maxChangedLines ?? 500;
    const batches: FileChange[][] = [];
    let batch: FileChange[] = [];
    let count = 0;
    for (const file of files) {
      for (const part of splitDiff(file, limit, Math.floor((this.options.maxPromptChars ?? 90_000) / 2))) {
        if (batch.length && (count + part.linesChanged > limit || batch.reduce((n, f) => n + f.diff.length, 0) + part.diff.length > 45_000)) {
          batches.push(batch); batch = []; count = 0;
        }
        batch.push(part); count += part.linesChanged;
      }
    }
    if (batch.length) batches.push(batch);
    return batches;
  }

  getContext(snapshot: ChangeSnapshot, file: string, lineRange: [number, number], side = 'after'): string {
    const text = (side === 'before' ? snapshot.before : snapshot.sources)[file];
    if (text === undefined) return `[unavailable: ${file} (${side})]`;
    const lines = text.split('\n');
    const start = Math.max(1, lineRange[0] - 35);
    const end = Math.min(lines.length, lineRange[1] + 35, start + 179);
    return `${file} (${side})\n${lines.slice(start - 1, end).map((line, i) => `${start + i}: ${line}`).join('\n')}`;
  }
}

export function countChanged(diff: string): number {
  return diff.split('\n').filter(l => /^[+-]/.test(l) && !/^(---|\+\+\+)/.test(l)).length;
}

function splitDiff(file: FileChange, limit: number, chars: number): FileChange[] {
  const lines = file.diff.split('\n');
  const firstHunk = lines.findIndex(l => l.startsWith('@@'));
  if (firstHunk < 0) return [file];
  const header = lines.slice(0, firstHunk).join('\n');
  const parts: FileChange[] = [];
  let chunk: string[] = []; let changed = 0; let bytes = 0; let old = 1; let current = 1;
  let startOld = 1; let startNew = 1; let oldCount = 0; let newCount = 0;
  const flush = () => {
    if (!chunk.length) return;
    parts.push({ ...file, diff: `${header}\n@@ -${startOld},${oldCount} +${startNew},${newCount} @@\n${chunk.join('\n')}\n`, linesChanged: changed });
    chunk = []; changed = 0; bytes = 0; oldCount = 0; newCount = 0;
  };
  for (const line of lines.slice(firstHunk)) {
    const hunk = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line);
    if (hunk) { flush(); old = Number(hunk[1]); current = Number(hunk[2]); continue; }
    if (!/^[ +\-\\]/.test(line)) continue;
    if (chunk.length && ((/^[+-]/.test(line) && changed >= limit) || bytes + line.length > chars)) flush();
    if (!chunk.length) { startOld = old; startNew = current; }
    chunk.push(line); bytes += line.length;
    if (line[0] === '+' || line[0] === '-') changed++;
    if (line[0] === ' ' || line[0] === '-') { old++; oldCount++; }
    if (line[0] === ' ' || line[0] === '+') { current++; newCount++; }
  }
  flush();
  return parts;
}

export function changedSources(previous: ChangeSnapshot, current: ChangeSnapshot): string[] {
  return [...new Set([...Object.keys(previous.sources), ...Object.keys(current.sources)])]
    .filter(file => previous.sources[file] !== current.sources[file]);
}

export function incrementalFiles(previous: ChangeSnapshot, current: ChangeSnapshot): FileChange[] {
  return changedSources(previous, current).map(file => {
    const before = previous.sources[file]?.split('\n') ?? [];
    const after = current.sources[file]?.split('\n') ?? [];
    let prefix = 0; let suffix = 0;
    while (prefix < before.length && prefix < after.length && before[prefix] === after[prefix]) prefix++;
    while (suffix < before.length - prefix && suffix < after.length - prefix && before[before.length - 1 - suffix] === after[after.length - 1 - suffix]) suffix++;
    const removed = before.slice(prefix, before.length - suffix);
    const added = after.slice(prefix, after.length - suffix);
    return { file, status: previous.sources[file] === undefined ? 'A' : current.sources[file] === undefined ? 'D' : 'M',
      linesChanged: removed.length + added.length,
      diff: `diff --git a/${file} b/${file}\n--- a/${file}\n+++ b/${file}\n@@ -${prefix + 1},${removed.length} +${prefix + 1},${added.length} @@\n${[...removed.map(l => '-' + l), ...added.map(l => '+' + l)].join('\n')}\n` };
  });
}
