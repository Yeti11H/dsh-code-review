import test from 'node:test';
import assert from 'node:assert/strict';
import { rename, rm, symlink } from 'node:fs/promises';
import path from 'node:path';
import { GitService, incrementalFiles } from '../dist/core.js';
import { fixture } from './helpers.mjs';

test('working snapshot includes staged, unstaged, Unicode paths and untracked files', async t => {
  const f = await fixture(t); await f.write('index.js', 'export const value = 2;\n'); f.git('add', 'index.js');
  await f.write('index.js', 'export const value = 3;\n'); await f.write('中文 空格.js', 'export const other = 4;\n');
  const s = await new GitService(f.root).getChanges('unstaged');
  assert.equal(s.sources['index.js'], 'export const value = 3;\n');
  assert.equal(s.files.length, 2); assert.ok(s.files.some(x => x.file === '中文 空格.js'));
  assert.equal(s.hash, (await new GitService(f.root).getChanges()).hash);
});

test('branch snapshot reads committed HEAD rather than dirty working tree', async t => {
  const f = await fixture(t); f.git('switch', '-qc', 'feature');
  await f.write('index.js', 'export const value = 2;\n'); f.git('add', '.'); f.git('commit', '-qm', 'feature');
  await f.write('index.js', 'SECRET_DIRTY_WORKING_COPY'); await f.write('untracked.js', 'not committed');
  const s = await new GitService(f.root).getChanges('main');
  assert.equal(s.sources['index.js'], 'export const value = 2;\n');
  assert.equal(s.sources['untracked.js'], undefined); assert.ok(!JSON.stringify(s).includes('SECRET_DIRTY'));
});

test('snapshot hash changes when an unchanged caller changes', async t => {
  const f = await fixture(t); await f.write('caller.js', 'import { value } from "./index.js";\n');
  f.git('add', '.'); f.git('commit', '-qm', 'caller'); await f.write('index.js', 'export const value = 2;\n');
  const git = new GitService(f.root); const first = await git.getChanges();
  await f.write('caller.js', '// new calling convention\n');
  const second = await git.getChanges(); assert.notEqual(first.hash, second.hash);
  assert.equal(first.sources['caller.js'], 'import { value } from "./index.js";\n');
});

test('reports do not recursively enter the next snapshot; secrets are excluded', async t => {
  const f = await fixture(t); await f.write('index.js', 'changed\n');
  const git = new GitService(f.root); const first = await git.getChanges();
  await f.write('.dsh-review/report.json', 'report'); await f.write('.env', 'TOKEN=hidden');
  const second = await git.getChanges();
  assert.equal(second.sources['.env'], undefined); assert.ok(!JSON.stringify(second).includes('TOKEN=hidden'));
  assert.ok(second.omissions.some(s => s.includes('.env')));
  await rm(path.join(f.root, '.env')); assert.equal((await git.getChanges()).hash, first.hash);
});

test('rename and delete preserve old source and file identity', async t => {
  const f = await fixture(t); await rename(path.join(f.root, 'index.js'), path.join(f.root, 'renamed.js'));
  const s = await new GitService(f.root).getChanges();
  assert.ok(s.files.some(x => x.file === 'index.js' && x.status === 'D'));
  assert.ok(s.files.some(x => x.file === 'renamed.js' && x.status === 'A'));
  assert.equal(s.before['index.js'], 'export const value = 1;\n');
});

test('binary and oversized sources produce explicit omissions', async t => {
  const f = await fixture(t); await f.write('binary.bin', Buffer.from([0, 1, 2])); await f.write('huge.txt', 'x'.repeat(200));
  const s = await new GitService(f.root, { maxFileBytes: 100 }).getChanges();
  assert.equal(s.sources['binary.bin'], undefined); assert.equal(s.sources['huge.txt'], undefined);
  assert.equal(s.omissions.length, 2);
});

test('symlink source is not followed', async t => {
  const f = await fixture(t);
  try { await symlink(path.join(f.root, 'index.js'), path.join(f.root, 'link.js')); }
  catch (error) { if (error.code === 'EPERM') { t.skip('OS does not grant symlink creation'); return; } throw error; }
  const s = await new GitService(f.root).getChanges(); assert.equal(s.sources['link.js'], undefined);
});

test('one large file splits into bounded nonempty batches without losing changed lines', async t => {
  const f = await fixture(t); await f.write('large.js', Array.from({ length: 1200 }, (_, i) => `export const v${i} = ${i};`).join('\n'));
  const git = new GitService(f.root); const s = await git.getChanges(); const batches = git.splitLargeChanges(s.files);
  assert.ok(batches.length >= 3); assert.ok(batches.every(b => b.length && b.reduce((sum, f) => sum + f.linesChanged, 0) <= 500));
  assert.equal(batches.flat().reduce((sum, f) => sum + f.linesChanged, 0), s.files.reduce((sum, f) => sum + f.linesChanged, 0));
});

test('incremental diff includes caller changes but not unchanged original changes', async t => {
  const f = await fixture(t); await f.write('index.js', 'first edit\n');
  const git = new GitService(f.root); const old = await git.getChanges(); await f.write('caller.js', 'new caller\n');
  const now = await git.getChanges(); const incremental = incrementalFiles(old, now);
  assert.deepEqual(incremental.map(f => f.file), ['caller.js']);
});

test('malicious Git ref stays data and cannot create a marker', async t => {
  const f = await fixture(t); const git = new GitService(f.root);
  await assert.rejects(git.getChanges('--output=marker'), /Invalid Git reference/);
  await assert.rejects(git.getChanges('main; echo hacked'), /Git failed/);
});
