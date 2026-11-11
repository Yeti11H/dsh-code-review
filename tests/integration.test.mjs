import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { ReviewService, StorageService } from '../dist/core.js';
import { fixture, context, bug, fixed, candidate, verified, raceModel, scripted } from './helpers.mjs';

test('scripted two-pass integration validates race evidence and persists exact model calls', async t => {
  const f = await fixture(t); await f.write('index.js', bug);
  const model = raceModel(); const service = new ReviewService(f.root, model);
  const result = await service.startReview('unstaged', context);
  assert.equal(result.status, 'completed'); assert.equal(result.confirmedIssues, 1);
  assert.deepEqual(model.calls.map(c => c.phase), ['scan', 'verify']);
  const session = await service.storage.loadSession(result.sessionId);
  assert.equal(session.rounds[0].issues[0].code_evidence[0].quote, '  await publish(event);');
  assert.equal(session.calls.length, 2); assert.ok(session.calls[0].prompt); assert.ok(session.calls[1].response);
  assert.ok((await readFile(result.reportPath, 'utf8')).includes('不是合并批准'));
});

test('clean scripted response does not invent findings or claim tests ran', async t => {
  const f = await fixture(t); await f.write('index.js', fixed);
  const service = new ReviewService(f.root, scripted(() => [])); const result = await service.startReview('unstaged', context);
  assert.equal(result.confirmedIssues, 0); assert.ok(result.report.includes('本轮没有执行测试'));
  assert.ok(!result.report.includes('可以合并代码')); assert.ok(result.report.includes('再决定是否合并'));
});

test('unsupported evidence downgrades a confirmed verdict', async t => {
  const f = await fixture(t); await f.write('index.js', bug);
  const model = scripted(phase => phase === 'scan' ? [candidate()] : verified({ code_evidence: [{ file: 'index.js', lineRange: [3, 3], quote: 'made up code' }] }));
  const service = new ReviewService(f.root, model); const result = await service.startReview('unstaged', context);
  assert.equal(result.confirmedIssues, 0); assert.equal(result.needsCheck, 1);
});

test('model cannot self-assert executed tests', async t => {
  const f = await fixture(t); await f.write('index.js', bug);
  const service = new ReviewService(f.root, scripted(phase => phase === 'scan' ? [candidate()] : verified({ verification_status: 'executed_test' })));
  const result = await service.startReview('unstaged', context); const s = await service.storage.loadSession(result.sessionId);
  assert.equal(s.rounds[0].issues[0].verification_status, 'code_analysis_only'); assert.equal(s.rounds[0].tests.length, 0);
});

test('missing business rules downgrade business-dependent conclusions', async t => {
  const f = await fixture(t); await f.write('index.js', bug);
  const service = new ReviewService(f.root, scripted(phase => phase === 'scan' ? [{ ...candidate(), business_dependent: true }] : verified()));
  const result = await service.startReview('unstaged', { requirement: '', businessRules: [], outOfScope: [] });
  assert.equal(result.needsCheck, 1); assert.match(result.report, /业务预期尚未确认/);
});

test('false-positive explanation remains visible and does not become an open defect', async t => {
  const f = await fixture(t); await f.write('index.js', fixed);
  const model = scripted(phase => phase === 'scan' ? [candidate()] : verified({ verdict: 'false_positive',
    code_evidence: [{ file: 'index.js', lineRange: [3, 3], quote: '  await publish(event, { onlyIfNewer: true });' }], rationale: '发布方已执行原子版本条件检查' }));
  const service = new ReviewService(f.root, model); const r = await service.startReview('unstaged', context);
  assert.equal(r.confirmedIssues, 0); assert.equal(r.needsCheck, 0); assert.match(r.report, /发布方已执行原子版本条件检查/);
});

test('recheck resolves a fixed issue with current-code evidence and stable ID', async t => {
  const f = await fixture(t); await f.write('index.js', bug); let fixedNow = false;
  const model = scripted(phase => phase === 'scan' ? (fixedNow ? [] : [candidate()]) : verified(fixedNow ? {
    verdict: 'false_positive', resolved: true, rationale: '新增条件发布消除了旧版本覆盖路径',
    code_evidence: [{ file: 'index.js', lineRange: [3, 3], quote: '  await publish(event, { onlyIfNewer: true });' }],
  } : {}));
  const service = new ReviewService(f.root, model); const first = await service.startReview('unstaged', context);
  await f.write('index.js', fixed); fixedNow = true;
  const second = await service.recheck(first.sessionId); const s = await service.storage.loadSession(first.sessionId);
  assert.equal(second.confirmedIssues, 0); assert.equal(s.rounds.length, 2);
  assert.equal(s.rounds[1].issues[0].id, 'ISS-001'); assert.equal(s.rounds[1].issues[0].status, 'resolved');
  assert.deepEqual(s.rounds[1].changes.resolved, ['ISS-001']); assert.equal(s.rounds[0].issues[0].status, 'open');
});

test('unchanged code skips model calls and does not consume another round', async t => {
  const f = await fixture(t); await f.write('index.js', bug); const model = raceModel();
  const service = new ReviewService(f.root, model); const r = await service.startReview('unstaged', context);
  const second = await service.recheck(r.sessionId); assert.match(second.message, /代码未变化/);
  assert.equal(model.calls.length, 2); assert.equal((await service.storage.loadSession(r.sessionId)).rounds.length, 1);
});

test('three nonprogressing rounds trigger needs_human; unchanged call preserves escalation', async t => {
  const f = await fixture(t); await f.write('index.js', bug);
  const service = new ReviewService(f.root, raceModel()); const first = await service.startReview('unstaged', context);
  await f.write('index.js', bug + '// round 2\n'); await service.recheck(first.sessionId);
  await f.write('index.js', bug + '// round 3\n'); const third = await service.recheck(first.sessionId);
  assert.equal(third.status, 'needs_human');
  const fourth = await service.recheck(first.sessionId); assert.equal(fourth.status, 'needs_human');
  const session = await service.storage.loadSession(first.sessionId); assert.equal(session.rounds.length, 3); assert.equal(session.rounds[2].issues.length, 1);
});

test('new issues in all three rounds trigger needs_human including the latest round', async t => {
  const f = await fixture(t); await f.write('index.js', bug); let number = 1;
  const model = scripted((phase, input) => phase === 'scan' ? [candidate(`problem-${number}`)] : verified({
    title: input.finding.description, trigger_condition: input.finding.description, rationale: 'confirmed current code path',
    category: number === 2 ? 'security' : 'correctness',
    code_evidence: [{ file: 'index.js', lineRange: number === 3 ? [2, 2] : [3, 3], quote: number === 3 ? '  if (event.version < await loadVersion()) return;' : '  await publish(event);' }],
  }));
  const service = new ReviewService(f.root, model); const r = await service.startReview('unstaged', context);
  number = 2; await f.write('index.js', bug + '// 2\n'); await service.recheck(r.sessionId);
  number = 3; await f.write('index.js', bug + '// 3\n'); const last = await service.recheck(r.sessionId);
  assert.equal(last.status, 'needs_human');
});

test('malformed JSON yields failed report instead of reporting no defects', async t => {
  const f = await fixture(t); await f.write('index.js', bug);
  const service = new ReviewService(f.root, scripted(() => 'not JSON')); const r = await service.startReview('unstaged', context);
  assert.equal(r.status, 'failed'); assert.match(r.report, /invalid JSON/); assert.match(r.report, /审查未完成/);
});

test('out-of-batch finding is rejected rather than hidden', async t => {
  const f = await fixture(t); await f.write('index.js', bug);
  const service = new ReviewService(f.root, scripted(() => [candidate('bad', '../../secret')]));
  const r = await service.startReview('unstaged', context); assert.equal(r.status, 'failed');
});

test('cancellation persists an incomplete session and releases review lock', async t => {
  const f = await fixture(t); await f.write('index.js', bug); const controller = new AbortController();
  const model = { async complete() { controller.abort(new Error('stop requested')); await new Promise(resolve => setTimeout(resolve, 10)); return '[]'; } };
  const service = new ReviewService(f.root, model); const r = await service.startReview('unstaged', context, controller.signal);
  assert.equal(r.status, 'cancelled');
  const fresh = new ReviewService(f.root, scripted(() => [])); assert.equal((await fresh.startReview('unstaged', context)).status, 'completed');
});

test('model timeout produces an incomplete report even if client ignores abort', async t => {
  const f = await fixture(t); await f.write('index.js', bug);
  const service = new ReviewService(f.root, { complete: async () => new Promise(() => {}) }, { modelTimeoutMs: 50 });
  const keepAlive = setInterval(() => {}, 10); t.after(() => clearInterval(keepAlive));
  const result = await service.startReview('unstaged', context); assert.equal(result.status, 'failed'); assert.match(result.report, /timed out|timeout/i);
});

test('changes during review mark report stale', async t => {
  const f = await fixture(t); await f.write('index.js', bug);
  const model = scripted(async phase => { if (phase === 'scan') { await f.write('index.js', fixed); return []; } return verified(); });
  const service = new ReviewService(f.root, model); const r = await service.startReview('unstaged', context);
  assert.equal(r.status, 'needs_human'); assert.match(r.report, /已过期/);
});

test('check_status detects later source changes', async t => {
  const f = await fixture(t); await f.write('index.js', bug);
  const service = new ReviewService(f.root, scripted(() => [])); const r = await service.startReview('unstaged', context);
  await f.write('index.js', fixed); const status = await service.checkStatus(r.sessionId); assert.match(status.report, /已过期/);
  assert.equal((await service.checkStatus()).length, 1);
});

test('tests run only with explicit option and configured argv; record real exit and output', async t => {
  const f = await fixture(t); await f.write('index.js', fixed);
  const service = new ReviewService(f.root, scripted(() => []), { testCommands: [{ file: process.execPath, args: ['-e', 'console.log("executed validation")'] }] });
  const first = await service.startReview('unstaged', context); const s1 = await service.storage.loadSession(first.sessionId);
  assert.equal(s1.rounds[0].tests.length, 0);
  await service.recheck(first.sessionId, true); const s2 = await service.storage.loadSession(first.sessionId);
  assert.equal(s2.rounds[1].tests[0].exitCode, 0); assert.match(s2.rounds[1].tests[0].stdout, /executed validation/);
  const noCommands = new ReviewService(f.root, scripted(() => [])); await assert.rejects(noCommands.recheck(first.sessionId, true), /not configured/);
});

test('failed test prevents clean completion', async t => {
  const f = await fixture(t); await f.write('index.js', fixed);
  const service = new ReviewService(f.root, scripted(() => []), { testCommands: [{ file: process.execPath, args: ['-e', 'process.exit(7)'] }] });
  const r = await service.startReview('unstaged', context); assert.equal((await service.recheck(r.sessionId, true)).status, 'needs_human');
});

test('omitted changed files escalate instead of silently claiming complete coverage', async t => {
  const f = await fixture(t); await f.write('huge.js', 'x'.repeat(1000));
  const service = new ReviewService(f.root, scripted(() => []), { maxFileBytes: 100 });
  const result = await service.startReview('unstaged', context); assert.equal(result.status, 'needs_human'); assert.match(result.report, /huge.js/);
});

test('storage prevents path traversal, corruption and overlapping review mutations', async t => {
  const f = await fixture(t); const store = new StorageService(f.root);
  await assert.rejects(store.loadSession('../secret'), /Invalid review session ID/);
  await store.withLock(async () => { await assert.rejects(store.withLock(async () => {}), /Another review/); });
  const service = new ReviewService(f.root, scripted(() => [])); await f.write('index.js', fixed);
  const r = await service.startReview('unstaged', context);
  await f.write(`.dsh-review/${r.sessionId}.json`, '{}'); await assert.rejects(store.loadSession(r.sessionId), /Invalid or incompatible/);
});

test('runtime reproduces race and verifies the version-isolated publishing fix', async () => {
  const unsafe = await import('../examples/test-cases/case-1-race-condition/before.ts');
  const safe = await import('../examples/test-cases/case-1-race-condition/after.ts');
  for (const [implementation, expected] of [[unsafe.update, 3], [safe.update, 4]]) {
    let current = 2; let release; let reached;
    const paused = new Promise(resolve => { release = resolve; });
    const ready = new Promise(resolve => { reached = resolve; });
    const load = async () => current;
    const store = { write: async event => { if (event.version === 3) { reached(); await paused; } return event; },
      publish: async (event, conditional) => { if (!conditional || event.version > current) current = event.version; } };
    const old = implementation({ version: 3 }, load, store); await ready;
    await implementation({ version: 4 }, load, store); release(); await old;
    assert.equal(current, expected);
  }
});

test('a resolved issue reintroduced later reopens under the same ID', async t => {
  const f = await fixture(t); await f.write('index.js', bug); let fixedNow = false;
  const model = scripted(phase => phase === 'scan' ? (fixedNow ? [] : [candidate()]) : verified(fixedNow ? {
    verdict: 'false_positive', resolved: true, rationale: '原子条件发布消除竞争',
    code_evidence: [{ file: 'index.js', lineRange: [3, 3], quote: '  await publish(event, { onlyIfNewer: true });' }],
  } : {}));
  const service = new ReviewService(f.root, model); const r = await service.startReview('unstaged', context);
  fixedNow = true; await f.write('index.js', fixed); await service.recheck(r.sessionId);
  fixedNow = false; await f.write('index.js', bug); const final = await service.recheck(r.sessionId);
  assert.equal(final.confirmedIssues, 1); const s = await service.storage.loadSession(r.sessionId);
  assert.equal(s.rounds[2].issues.length, 1); assert.equal(s.rounds[2].issues[0].id, 'ISS-001');
  assert.equal(s.rounds[2].issues[0].status, 'open');
});

test('a false-positive recheck without current evidence cannot auto-resolve an old issue', async t => {
  const f = await fixture(t); await f.write('index.js', bug); let next = false;
  const model = scripted(phase => phase === 'scan' ? (next ? [] : [candidate()]) : verified(next ? {
    verdict: 'false_positive', resolved: true, rationale: '声称已解决但没有反证', code_evidence: [],
  } : {}));
  const service = new ReviewService(f.root, model); const r = await service.startReview('unstaged', context);
  next = true; await f.write('index.js', bug + '// change\n'); const last = await service.recheck(r.sessionId);
  assert.equal(last.needsCheck, 1); assert.equal((await service.storage.loadSession(r.sessionId)).rounds[1].issues[0].status, 'open');
});

test('accepted risks stay visible and require a reason; reopening restores the issue', async t => {
  const f = await fixture(t); await f.write('index.js', bug);
  const service = new ReviewService(f.root, raceModel()); const r = await service.startReview('unstaged', context);
  await assert.rejects(service.disposition(r.sessionId, 'ISS-001', 'wont_fix', ''), /reason is required/);
  const accepted = await service.disposition(r.sessionId, 'ISS-001', 'wont_fix', '负责人接受，另行修复');
  assert.equal(accepted.confirmedIssues, 0); assert.match(accepted.report, /负责人接受，另行修复/);
  assert.equal((await service.disposition(r.sessionId, 'ISS-001', 'reopen', '重新评估')).confirmedIssues, 1);
});

test('branch review refuses test execution against dirty working sources', async t => {
  const f = await fixture(t); f.git('switch', '-qc', 'feature'); await f.write('index.js', fixed);
  f.git('add', '.'); f.git('commit', '-qm', 'feature');
  const service = new ReviewService(f.root, scripted(() => []), { testCommands: [{ file: process.execPath, args: ['-e', 'process.exit(0)'] }] });
  const r = await service.startReview('main', context); await f.write('index.js', bug);
  const result = await service.recheck(r.sessionId, true); assert.equal(result.status, 'failed'); assert.match(result.report, /different working tree/);
});

test('unchanged source plus repeated tests does not consume convergence budget', async t => {
  const f = await fixture(t); await f.write('index.js', bug);
  const service = new ReviewService(f.root, raceModel(), { testCommands: [{ file: process.execPath, args: ['-e', 'process.exit(0)'] }] });
  const r = await service.startReview('unstaged', context); await service.recheck(r.sessionId, true);
  const last = await service.recheck(r.sessionId, true); assert.equal(last.status, 'completed');
});
