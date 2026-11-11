import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ReviewService, GitService, calculateRiskScore, riskSummary, scanRules, validateRules } from '../dist/core.js';
import { fixture, bug, fixed, candidate, verified, scripted, context } from './helpers.mjs';

test('risk ranking preserves the highest unresolved risk and never approves incomplete analysis', () => {
  const issue = { ...verified(), status: 'open' };
  assert.equal(calculateRiskScore(issue), 9);
  assert.equal(calculateRiskScore({ ...issue, status: 'resolved' }), 0);
  const session = { status: 'completed', stale: false, rounds: [{ issues: [issue, { ...issue, optional: true, category: 'maintainability' }] }] };
  assert.equal(riskSummary(session).overallRiskScore, 9);
  assert.equal(riskSummary(session).recommendation, 'request_changes');
  assert.equal(riskSummary({ ...session, status: 'failed' }).recommendation, 'needs_human_review');
  assert.equal(riskSummary({ ...session, rounds: [{ issues: [] }] }).recommendation, 'no_findings');
});

const rule = { name: 'eval check', pattern: '\\beval\\(', severity: 'critical', category: 'security', message: 'Verify input origin' };
test('custom rules scan added lines only, surface matching quotes and never invent confirmed issues', async t => {
  const f = await fixture(t, "export const baseline = 'eval(unsafe)';\n");
  await f.write('index.js', "export const baseline = 'eval(unsafe)';\nexport const next = 'eval(input)';\n");
  const model = scripted((phase, input) => { assert.equal(input.customRuleMatches.length, 1); assert.equal(input.customRuleMatches[0].lineRange[0], 2); return []; });
  const service = new ReviewService(f.root, model, { customRules: [rule] });
  const result = await service.startReview('working', context);
  assert.equal(result.confirmedIssues, 0);
  assert.match(result.report, /自定义规则命中（1）/);
  assert.match(result.report, /不自动证明缺陷/);
  assert.throws(() => validateRules([{ ...rule, pattern: '(' }]), /regex/);
});

test('pathological regex is terminated without blocking the review process', async t => {
  const f = await fixture(t); await f.write('index.js', 'a'.repeat(3000) + '!\n');
  const git = new GitService(f.root); const snapshot = await git.getChanges();
  const started = Date.now();
  const result = await scanRules(snapshot, snapshot.files, [{ ...rule, pattern: '(a+)+$' }]);
  assert.match(result.notes.join(' '), /超时/);
  assert.ok(Date.now() - started < 6000);
});

test('explicit feedback is reused only for matching source and business context; reopening removes it', async t => {
  const f = await fixture(t); await f.write('index.js', bug);
  let feedback;
  const model = scripted((phase, input) => {
    if (phase === 'scan') { feedback = input.historicalFeedback; return [candidate()]; }
    return verified();
  });
  const service = new ReviewService(f.root, model, { learningMode: true });
  const first = await service.startReview('working', context);
  await service.disposition(first.sessionId, 'ISS-001', 'false_positive', 'Verified upstream serial queue');
  await service.startReview('working', context);
  assert.equal(feedback.length, 1);
  assert.equal(feedback[0].action, 'false_positive');
  await service.startReview('working', { ...context, businessRules: ['Different rule'] });
  assert.equal(feedback.length, 0);
  await service.disposition(first.sessionId, 'ISS-001', 'reopen', 'The queue guarantee changed');
  assert.equal((await service.storage.loadLearnings()).length, 0);
  const changedModel = scripted((phase, input) => { if (phase === 'scan') { assert.equal(input.historicalFeedback.length, 0); return []; } return verified(); });
  await service.disposition(first.sessionId, 'ISS-001', 'wont_fix', 'Accepted by owner');
  await f.write('index.js', fixed);
  await new ReviewService(f.root, changedModel, { learningMode: true }).startReview('working', context);
});

function cli(args, env) {
  return new Promise((resolve, reject) => {
    const script = fileURLToPath(new URL('../scripts/ci-review.mjs', import.meta.url));
    const child = spawn(process.execPath, [script, ...args], { env: { ...process.env, ...env }, windowsHide: true });
    let stdout = '', stderr = '';
    child.stdout.on('data', b => { stdout += b; }); child.stderr.on('data', b => { stderr += b; });
    child.on('error', reject); child.on('close', code => resolve({ code, stdout, stderr }));
  });
}

test('CI CLI creates real JSON/Markdown, gates confirmed defects and fails closed on provider errors', async t => {
  const f = await fixture(t); await f.write('index.js', bug);
  let fail = false, clean = false;
  const server = createServer(async (req, res) => {
    const chunks = []; for await (const b of req) chunks.push(b);
    const input = JSON.parse(Buffer.concat(chunks));
    assert.equal(req.headers.authorization, 'Bearer local-fixture-key');
    if (fail) { res.writeHead(503).end('{}'); return; }
    const scan = input.messages[1].content.includes('第一轮：扫描');
    const content = JSON.stringify(scan ? clean ? [] : [candidate()] : verified());
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ model: 'test-model', choices: [{ finish_reason: 'stop', message: { content } }], usage: { total_tokens: 10 } }));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const output = path.join(f.root, '.dsh-review', 'ci.json');
  const args = ['--cwd', f.root, '--requirement', context.requirement, '--business-rules', context.businessRules[0], '--api-base', `http://127.0.0.1:${server.address().port}`, '--output-json', output, '--exit-code'];
  const result = await cli(args, { DEEPSEEK_API_KEY: 'local-fixture-key' });
  assert.equal(result.code, 1, result.stderr);
  const json = JSON.parse(await readFile(output, 'utf8'));
  assert.equal(json.overallRiskScore, 9);
  assert.equal(json.recommendation, 'request_changes');
  assert.match(await readFile(output.replace('.json', '.md'), 'utf8'), /风险处理优先级/);
  clean = true; const noFindings = await cli(args, { DEEPSEEK_API_KEY: 'local-fixture-key' }); assert.equal(noFindings.code, 0, noFindings.stderr);
  fail = true; const failed = await cli(args, { DEEPSEEK_API_KEY: 'local-fixture-key' }); assert.equal(failed.code, 2);
  assert.equal(JSON.parse(await readFile(output, 'utf8')).status, 'failed');
  const noKey = await cli(args, { DEEPSEEK_API_KEY: '' }); assert.equal(noKey.code, 2); assert.match(noKey.stderr, /DEEPSEEK_API_KEY/);
});
