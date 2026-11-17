import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { readFile, writeFile, cp, mkdir, rm } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { CodexReview } from '../dist/codex/review.js';
import { StorageService } from '../dist/services/storage.js';
import { fixture, bug, context, candidate, verified } from './helpers.mjs';

const runner = fileURLToPath(new URL('../scripts/codex-review.mjs', import.meta.url));
const bundle = fileURLToPath(new URL('../skills/dsh-code-review/', import.meta.url));
const binding = s => ({ sessionId: s.sessionId, codeHash: s.codeHash, contextHash: s.contextHash });
const scan = (s, findings = [candidate()], reviewedFiles = ['index.js']) => ({ ...binding(s), reviewedFiles, omissions: [], findings });
const verify = (s, result = verified()) => ({ ...binding(s), verifications: [{ candidateId: 'FD-1', result }] });
async function setup(t, input = context) {
  const f = await fixture(t); await f.write('index.js', bug);
  const adapter = new CodexReview(f.root);
  const prepared = await adapter.prepare('working', input);
  return { ...f, adapter, prepared };
}
async function cli(args, entry = runner) {
  return new Promise((resolve, reject) => execFile(process.execPath, [entry, ...args],
    { encoding: 'utf8', windowsHide: true, env: { ...process.env, DEEPSEEK_API_KEY: '' } },
    (error, stdout, stderr) => {
      if (error && typeof error.code !== 'number') return reject(error);
      resolve({ code: error?.code ?? 0, stdout, stderr });
    }));
}

test('Codex prepare remains incomplete and exposes frozen, bounded source and context', async t => {
  const f = await setup(t);
  assert.equal(f.prepared.status, 'in_progress');
  assert.equal(f.prepared.phase, 'scan');
  const input = await f.adapter.input(f.prepared.sessionId);
  assert.deepEqual(input.context, context);
  assert.ok(input.changes[0].diff.includes('await publish(event)'));
  const source = await f.adapter.context(f.prepared.sessionId, 'index.js', 'after', 1, 4);
  assert.match(source.content, /3:   await publish\(event\);/);
  await assert.rejects(f.adapter.context(f.prepared.sessionId, '../outside', 'after', 1, 2), /Invalid code location/);
  await assert.rejects(f.adapter.context(f.prepared.sessionId, 'index.js', 'after', 1, 201), /at most 200/);
  assert.match(await readFile(f.prepared.reportPath, 'utf8'), /审查未完成|本次审查未完成/);
});

test('Codex imports every verified candidate, stores host provenance and never invents executed tests', async t => {
  const f = await setup(t); const s = f.prepared;
  await f.adapter.scan(s.sessionId, scan(s));
  const input = await f.adapter.input(s.sessionId);
  assert.equal(input.candidates[0].id, 'FD-1');
  const result = await f.adapter.finish(s.sessionId, verify(s, verified({ verification_status: 'executed_test', tests: [{ exitCode: 0 }] })));
  assert.equal(result.status, 'completed'); assert.equal(result.confirmedIssues, 1);
  const saved = await f.adapter.storage.loadSession(s.sessionId);
  assert.equal(saved.rounds[0].issues[0].id, 'ISS-001');
  assert.equal(saved.rounds[0].issues[0].verification_status, 'code_analysis_only');
  assert.deepEqual(saved.calls, []); assert.deepEqual(saved.rounds[0].tests, []);
  assert.deepEqual(await new StorageService(f.root).listSessions(), [], 'DSH must not pick up Codex sessions');
  assert.equal(saved.codex.verification.verifications.length, 1);
  assert.match(await readFile(result.reportPath, 'utf8'), /同一会话，不保证判断独立/);
});

test('Codex rejects response bindings, out-of-target findings and premature finalize without losing pending state', async t => {
  const f = await setup(t); const s = f.prepared;
  await assert.rejects(f.adapter.scan(s.sessionId, { ...scan(s), codeHash: 'wrong' }), /codeHash/);
  await assert.rejects(f.adapter.scan(s.sessionId, scan(s, [candidate('x', 'missing.js')])), /outside readable/);
  await assert.rejects(f.adapter.finish(s.sessionId, verify(s)), /Expected verify/);
  assert.equal((await f.adapter.status(s.sessionId)).phase, 'scan');
  await f.adapter.scan(s.sessionId, scan(s));
  for (const entries of [[], [{ candidateId: 'FD-9', result: verified() }], verify(s).verifications.concat(verify(s).verifications)]) {
    await assert.rejects(f.adapter.finish(s.sessionId, { ...binding(s), verifications: entries }), /exactly one/);
  }
  await assert.rejects(f.adapter.finish(s.sessionId, verify(s, verified({ category: 'invalid' }))), /category/);
  assert.equal((await f.adapter.status(s.sessionId)).phase, 'verify');
  assert.equal((await f.adapter.finish(s.sessionId, verify(s))).confirmedIssues, 1);
});

test('Codex invalid quotes and missing business rules downgrade conclusions including rejected candidates', async t => {
  const f = await setup(t, { requirement: '', businessRules: [], outOfScope: [] }); const s = f.prepared;
  await f.adapter.scan(s.sessionId, scan(s));
  const out = await f.adapter.finish(s.sessionId, verify(s, verified({ verdict: 'false_positive', business_dependent: true,
    code_evidence: [{ file: 'index.js', lineRange: [3, 3], quote: 'invented guard' }] })));
  assert.equal(out.needsCheck, 1);
  const issue = (await f.adapter.storage.loadSession(s.sessionId)).rounds[0].issues[0];
  assert.equal(issue.status, 'open'); assert.deepEqual(issue.code_evidence, []);
  assert.match(issue.rationale, /业务预期尚未确认/);
});

test('Codex empty analysis is completed only after explicit verification; omitted files require human review', async t => {
  const f = await setup(t); const s = f.prepared;
  await f.adapter.scan(s.sessionId, scan(s, [], []));
  assert.equal((await f.adapter.status(s.sessionId)).status, 'in_progress');
  const result = await f.adapter.finish(s.sessionId, { ...binding(s), verifications: [] });
  assert.equal(result.status, 'needs_human');
  assert.equal(result.recommendation, 'needs_human_review');
  const saved = await f.adapter.storage.loadSession(s.sessionId);
  assert.ok(saved.rounds[0].coverage.omissions.includes('index.js: not reviewed by Codex'));
  const other = await f.adapter.prepare('working', context);
  await f.adapter.scan(other.sessionId, scan(other, []));
  assert.equal((await f.adapter.finish(other.sessionId, { ...binding(other), verifications: [] })).status, 'completed');
});

test('Codex excluded changed secrets remain omissions, never included as source', async t => {
  const f = await setup(t); await f.write('.env', 'SECRET=example-not-a-real-key');
  const s = await f.adapter.prepare('working', context);
  const saved = await f.adapter.storage.loadSession(s.sessionId);
  assert.equal(saved.snapshot.sources['.env'], undefined);
  await f.adapter.scan(s.sessionId, scan(s, []));
  const result = await f.adapter.finish(s.sessionId, { ...binding(s), verifications: [] });
  assert.equal(result.status, 'needs_human');
});

test('Codex detects changes while awaiting analysis and persists stale state instead of completion', async t => {
  const f = await setup(t); const s = f.prepared;
  await f.adapter.scan(s.sessionId, scan(s));
  await f.write('index.js', bug + '// later edit\n');
  await assert.rejects(f.adapter.finish(s.sessionId, verify(s)), /Source changed/);
  const status = await f.adapter.status(s.sessionId);
  assert.equal(status.stale, true); assert.equal(status.status, 'needs_human');
  assert.equal((await f.adapter.storage.loadSession(s.sessionId)).rounds.length, 0);
  assert.match(await readFile(status.reportPath, 'utf8'), /已过期/);
});

test('Codex status invalidates a completed report when sources change', async t => {
  const f = await setup(t); const s = f.prepared;
  await f.adapter.scan(s.sessionId, scan(s, []));
  await f.adapter.finish(s.sessionId, { ...binding(s), verifications: [] });
  await f.write('index.js', bug + '\n');
  assert.equal((await f.adapter.status(s.sessionId)).status, 'needs_human');
});

test('Codex cancellation is terminal and interrupted reviews stay pending', async t => {
  const f = await setup(t); const s = f.prepared;
  const resumed = new CodexReview(f.root);
  assert.equal((await resumed.status(s.sessionId)).phase, 'scan');
  const result = await resumed.cancel(s.sessionId, 'Unable to inspect required caller');
  assert.equal(result.status, 'cancelled');
  await assert.rejects(resumed.scan(s.sessionId, scan(s)), /found cancelled/);
});

test('Codex report write failure cannot commit a completed JSON session and permits retry', async t => {
  const f = await setup(t); const s = f.prepared;
  await f.adapter.scan(s.sessionId, scan(s, []));
  await rm(s.reportPath); await mkdir(s.reportPath);
  await assert.rejects(f.adapter.finish(s.sessionId, { ...binding(s), verifications: [] }));
  const saved = await f.adapter.storage.loadSession(s.sessionId);
  assert.equal(saved.status, 'in_progress'); assert.equal(saved.codex.phase, 'verify');
  assert.equal(saved.rounds.length, 0);
  await rm(s.reportPath, { recursive: true });
  assert.equal((await f.adapter.finish(s.sessionId, { ...binding(s), verifications: [] })).status, 'completed');
});

test('Codex deleted code uses before evidence and branch target excludes working edits', async t => {
  const f = await fixture(t, bug); f.git('switch', '-qc', 'feature');
  await f.write('index.js', ''); f.git('add', '.'); f.git('commit', '-qm', 'remove behavior');
  await f.write('index.js', 'uncommitted replacement');
  const adapter = new CodexReview(f.root); const s = await adapter.prepare('main', context);
  const saved = await adapter.storage.loadSession(s.sessionId);
  assert.equal(saved.snapshot.sources['index.js'], '');
  assert.equal(saved.snapshot.before['index.js'], bug);
  const c = { ...candidate(), location: { file: 'index.js', lineRange: [3, 3], side: 'before' } };
  await adapter.scan(s.sessionId, scan(s, [c]));
  const out = await adapter.finish(s.sessionId, verify(s, verified({ location: c.location,
    code_evidence: [{ ...c.location, quote: '  await publish(event);' }] })));
  assert.equal(out.confirmedIssues, 1);
});

test('Codex self-contained skill runs outside source tree without DSH, dependencies or API key', async t => {
  const f = await fixture(t); await f.write('index.js', bug);
  // Run a copied bundle with no package ancestor or dependency on the development tree.
  const destination = path.join(f.root, '.dsh-review', 'skill'); await cp(bundle, destination, { recursive: true });
  const entry = path.join(destination, 'scripts', 'review.mjs');
  const help = await cli(['--help'], entry); assert.equal(help.code, 0); assert.match(help.stdout, /no API key/);
  await mkdir(path.join(f.root, '.dsh-review'), { recursive: true });
  const input = path.join(f.root, '.dsh-review', 'context.json'); await writeFile(input, JSON.stringify(context));
  const prepared = await cli(['prepare', '--cwd', path.join(f.root, '.dsh-review'), '--context', input], entry);
  assert.equal(prepared.code, 0, prepared.stderr);
  const s = JSON.parse(prepared.stdout);
  assert.equal(s.phase, 'scan');
  const bad = await cli(['scan', '--cwd', f.root, '--session', s.sessionId, '--response', input], entry);
  assert.equal(bad.code, 2); assert.match(bad.stderr, /sessionId/);
  const unknown = await cli(['prepare', '--cwd', f.root, '--api-key', 'not-a-key'], entry);
  assert.equal(unknown.code, 2);
});
