import test from 'node:test';
import assert from 'node:assert/strict';
import { ReviewService } from '../dist/core.js';
import { fixture, bug, context, candidate, verified, scripted } from './helpers.mjs';

const relaxed = { requirement: '允许按任务完成顺序发布', businessRules: ['允许后完成的旧任务覆盖新版本'], outOfScope: [] };

test('changed business rules recheck unchanged code and retain each round context', async t => {
  const f = await fixture(t); await f.write('index.js', bug);
  const model = scripted((phase, input) => phase === 'scan'
    ? input.context.requirement === context.requirement ? [candidate()] : [] : verified());
  const service = new ReviewService(f.root, model);
  const first = await service.startReview('working', relaxed);
  assert.equal(first.confirmedIssues, 0);
  const next = await service.recheck(first.sessionId, false, undefined, context);
  assert.equal(next.confirmedIssues, 1, 'new rules must trigger a full review even without code edits');
  const session = await service.storage.loadSession(first.sessionId);
  assert.equal(session.rounds.length, 2);
  assert.deepEqual(session.rounds[0].contextSnapshot, relaxed);
  assert.deepEqual(session.rounds[1].contextSnapshot, context);
  assert.notEqual(session.rounds[0].contextHash, session.rounds[1].contextHash);
  const before = model.calls.length;
  await service.recheck(first.sessionId, false, undefined, { ...context });
  assert.equal(model.calls.length, before, 'identical source and context must skip model calls');
});

test('failed rule update preserves old analysis, remains stale on status checks, and retries full scope', async t => {
  const f = await fixture(t); await f.write('index.js', bug);
  let fail = false;
  const model = scripted((phase, input) => {
    if (fail) throw new Error('fixture provider offline');
    return phase === 'scan' ? input.context.requirement === context.requirement ? [candidate()] : [] : verified();
  });
  const service = new ReviewService(f.root, model);
  const first = await service.startReview('working', relaxed);
  fail = true;
  const failed = await service.recheck(first.sessionId, false, undefined, context);
  assert.equal(failed.status, 'failed');
  let session = await service.storage.loadSession(first.sessionId);
  assert.equal(session.rounds.length, 1);
  assert.deepEqual(session.context, context);
  assert.deepEqual(session.rounds[0].contextSnapshot, relaxed);
  assert.equal(session.stale, true);
  const status = await service.checkStatus(first.sessionId);
  assert.match(status.report, /最近完成轮次的业务依据/);
  assert.match(status.report, /允许后完成的旧任务覆盖新版本/);
  assert.match(status.report, /旧结论.*不适用/);
  fail = false;
  const retried = await service.recheck(first.sessionId);
  assert.equal(retried.confirmedIssues, 1);
  session = await service.storage.loadSession(first.sessionId);
  assert.equal(session.rounds.length, 2);
  assert.equal(session.stale, false);
});

test('legacy rounds freeze their original business inputs before a rule replacement', async t => {
  const f = await fixture(t); await f.write('index.js', bug);
  const service = new ReviewService(f.root, scripted(() => []));
  const first = await service.startReview('working', relaxed);
  const legacy = await service.storage.loadSession(first.sessionId);
  for (const round of legacy.rounds) { delete round.contextSnapshot; delete round.contextHash; }
  await service.storage.saveSession(legacy);
  await service.recheck(first.sessionId, false, undefined, context);
  const saved = await service.storage.loadSession(first.sessionId);
  assert.deepEqual(saved.rounds[0].contextSnapshot, relaxed);
  assert.deepEqual(saved.rounds[1].contextSnapshot, context);
  assert.equal(saved.rounds.length, 2);
});

test('new rules do not silently retain accepted risks or reuse prior-context feedback', async t => {
  const f = await fixture(t); await f.write('index.js', bug);
  const model = scripted((phase, input) => {
    if (input.context.requirement === relaxed.requirement) assert.deepEqual(input.historicalFeedback, []);
    return phase === 'scan' ? [candidate()] : verified();
  });
  const service = new ReviewService(f.root, model, { learningMode: true });
  const first = await service.startReview('working', context);
  await service.disposition(first.sessionId, 'ISS-001', 'wont_fix', 'Owner accepts under the original rules');
  assert.equal((await service.storage.loadLearnings()).length, 1);
  const updated = await service.recheck(first.sessionId, false, undefined, relaxed);
  const saved = await service.storage.loadSession(first.sessionId);
  assert.equal(updated.confirmedIssues, 1);
  assert.equal(saved.rounds[1].issues[0].id, 'ISS-001');
  assert.equal(saved.rounds[1].issues[0].status, 'open');
  assert.equal(saved.rounds[0].issues[0].status, 'wont_fix');
});

test('scope changes cannot auto-close an old issue even when the model asserts resolved', async t => {
  const f = await fixture(t); await f.write('index.js', bug);
  let changed = false;
  const model = scripted(phase => phase === 'scan' ? changed ? [] : [candidate()] : verified(changed ? {
    verdict: 'false_positive', resolved: true, rationale: '新范围不考虑版本顺序',
  } : {}));
  const service = new ReviewService(f.root, model);
  const first = await service.startReview('working', context);
  changed = true;
  const updated = await service.recheck(first.sessionId, false, undefined, { ...context, outOfScope: ['版本顺序'] });
  assert.equal(updated.needsCheck, 1);
  const saved = await service.storage.loadSession(first.sessionId);
  assert.equal(saved.rounds[1].issues[0].status, 'open');
  assert.deepEqual(saved.rounds[1].changes.resolved, []);
});

test('invalid replacement inputs do not mutate a session or call a model', async t => {
  const f = await fixture(t); await f.write('index.js', bug);
  const model = scripted(() => []), service = new ReviewService(f.root, model);
  const first = await service.startReview('working', context);
  const before = model.calls.length;
  for (const value of [null, { requirement: 'partial' }, { ...context, businessRules: [2] }, { ...context, requirement: 'x'.repeat(16001) }]) {
    await assert.rejects(service.recheck(first.sessionId, false, undefined, value), /Invalid review context|exceeds/);
  }
  assert.equal(model.calls.length, before);
  assert.deepEqual((await service.storage.loadSession(first.sessionId)).context, context);
});

test('reports distinguish impact, evidence, execution and human handoff without changing risk scores', async t => {
  const f = await fixture(t); await f.write('index.js', bug);
  const model = scripted(phase => phase === 'scan' ? [candidate()] : verified({ verdict: 'needs_check', rationale: '缺少 publish 内部实现，需核对原子条件保护' }));
  const service = new ReviewService(f.root, model);
  const first = await service.startReview('working', context);
  assert.match(first.report, /## 本轮摘要/);
  assert.match(first.report, /后果严重性：high/);
  assert.match(first.report, /核查结论：needs_check/);
  assert.match(first.report, /原文匹配.*不证明/);
  assert.match(first.report, /运行证据：本轮没有执行测试/);
  assert.match(first.report, /## 人工核查交接/);
  assert.match(first.report, /ISS-001.*缺少 publish 内部实现/);
  assert.equal(first.overallRiskScore, 7);
  assert.equal(first.recommendation, 'needs_human_review');
});

test('rule changes rescan the full target and property order alone does not invalidate a review', async t => {
  const f = await fixture(t); await f.write('index.js', bug); await f.write('other.js', 'export const limit = 100;\n');
  const scanned = [];
  const model = scripted((phase, input) => { if (phase === 'scan') scanned.push(input.changes.map(c => c.file)); return []; });
  const service = new ReviewService(f.root, model);
  const first = await service.startReview('working', context);
  await f.write('index.js', bug + '// changed\n');
  await service.recheck(first.sessionId, false, undefined, relaxed);
  assert.deepEqual(scanned[1].sort(), ['index.js', 'other.js']);
  const calls = model.calls.length;
  await service.recheck(first.sessionId, false, undefined, { outOfScope: [], businessRules: relaxed.businessRules, requirement: relaxed.requirement });
  assert.equal(model.calls.length, calls);
});

test('a new business task resets convergence counting but three subsequent code versions still escalate', async t => {
  const f = await fixture(t); await f.write('index.js', bug);
  const service = new ReviewService(f.root, scripted(phase => phase === 'scan' ? [candidate()] : verified()));
  const first = await service.startReview('working', context);
  await f.write('index.js', bug + '// old round 2\n'); await service.recheck(first.sessionId);
  const switched = await service.recheck(first.sessionId, false, undefined, relaxed);
  assert.equal(switched.status, 'completed', switched.report);
  await f.write('index.js', bug + '// new round 2\n');
  assert.equal((await service.recheck(first.sessionId)).status, 'completed');
  await f.write('index.js', bug + '// new round 3\n');
  const last = await service.recheck(first.sessionId);
  assert.equal(last.status, 'needs_human');
  assert.match(last.report, /连续不同代码版本的审查未收敛/);
});

test('a failed rule replacement cannot attach human feedback to old conclusions under new rules', async t => {
  const f = await fixture(t); await f.write('index.js', bug);
  let fail = false;
  const model = scripted(phase => { if (fail) throw new Error('offline'); return phase === 'scan' ? [candidate()] : verified(); });
  const service = new ReviewService(f.root, model, { learningMode: true });
  const first = await service.startReview('working', context);
  fail = true;
  await service.recheck(first.sessionId, false, undefined, relaxed);
  await assert.rejects(service.disposition(first.sessionId, 'ISS-001', 'false_positive', 'wrong context'), /业务依据.*复查/);
  assert.equal((await service.storage.loadLearnings()).length, 0);
});

test('restoring a stale snapshot does not invent a three-round convergence failure', async t => {
  const f = await fixture(t); await f.write('index.js', bug);
  const model = scripted(async () => { await f.write('index.js', bug + '// concurrent edit\n'); return []; });
  const service = new ReviewService(f.root, model);
  const first = await service.startReview('working', context);
  assert.equal(first.status, 'needs_human');
  await f.write('index.js', bug);
  const restored = await service.recheck(first.sessionId);
  assert.equal((await service.storage.loadSession(first.sessionId)).rounds.length, 1);
  assert.doesNotMatch(restored.report, /连续不同代码版本的审查未收敛/);
});
