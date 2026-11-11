import test from 'node:test';
import assert from 'node:assert/strict';
import { Context } from '@deepseek-ai/cordis';
import ToolsService from '@deepseek-ai/dsh-tools';
import { ToolExecutionPipeline } from '@deepseek-ai/dsh-tools/pipeline';
import SystemPrompt from '@deepseek-ai/dsh-system-prompt';
import LlmRuntime, { LlmAdapter } from '@deepseek-ai/dsh-llm';
import * as plugin from '../dist/index.js';
import { HarnessModelClient } from '../dist/services/harness-model.js';
import { fixture, bug, candidate, verified } from './helpers.mjs';

async function mount(t, config, adapter) {
  const ctx = new Context();
  const fibers = [ctx.plugin(SystemPrompt), ctx.plugin(LlmRuntime), ctx.plugin(ToolsService)];
  fibers.push(ctx.plugin({ name: 'test-review-adapter', inject: ['llm'], apply(child) { child.llm.registerAdapter(['test'], adapter); } }));
  const fiber = ctx.plugin(plugin, config);
  await Promise.all([...fibers, fiber].map(f => f.await()));
  t.after(async () => { await fiber.dispose(); for (const f of fibers.reverse()) await f.dispose(); });
  return ctx;
}

class ReviewAdapter extends LlmAdapter {
  calls = [];
  async *stream(options) {
    this.calls.push(options);
    const response = options.messages[0].content[0].text.includes('第一轮：扫描') ? [candidate()] : verified();
    const text = JSON.stringify(response);
    yield { type: 'block-start', index: 0, blockType: 'text' };
    yield { type: 'text-delta', index: 0, text };
    yield { type: 'block-end', index: 0, block: { type: 'text', text } };
    yield { type: 'finish', reason: { kind: 'stop' } };
  }
}

async function invoke(ctx, name, args, agent) {
  const pipeline = new ToolExecutionPipeline(ctx);
  const prepared = await pipeline.prepare({ name, arguments: args, agent, callId: 'call-test', signal: new AbortController().signal });
  const dispatched = prepared.kind === 'dispatch' ? await pipeline.dispatch(prepared.exec) : prepared;
  return pipeline.complete(prepared.exec, dispatched);
}

test('real Cordis + official tools + LLM runtime load plugin and dispatch a complete review', async t => {
  const f = await fixture(t); await f.write('index.js', bug); const adapter = new ReviewAdapter();
  const ctx = await mount(t, { cwd: f.root, provider: 'test', model: 'test-model' }, adapter);
  assert.deepEqual(ctx.tools.schemas().map(s => s.name).sort(), ['check_review_status', 'recheck', 'set_review_issue_status', 'start_review']);
  const result = await invoke(ctx, 'start_review', { requirement: 'update index', businessRules: ['new version must survive'] });
  assert.equal(result.isError, false, JSON.stringify(result)); assert.equal(result.value.confirmedIssues, 1);
  assert.equal(adapter.calls.length, 2); assert.ok(adapter.calls.every(c => c.purpose === 'code-review' && c.tools.length === 0));
  const status = await invoke(ctx, 'check_review_status', { sessionId: result.value.sessionId });
  assert.equal(status.isError, false); assert.equal(status.value.sessionId, result.value.sessionId);
});

test('official input validation rejects wrong argument types', async t => {
  const f = await fixture(t); const ctx = await mount(t, { cwd: f.root, provider: 'test', model: 'test-model' }, new ReviewAdapter());
  const r = await invoke(ctx, 'start_review', { businessRules: 42 }); assert.equal(r.isError, true);
});

test('bundle defaults follow each session workspace while installer cwd takes precedence', async t => {
  const first = await fixture(t); const second = await fixture(t);
  await first.write('index.js', bug); await second.write('index.js', bug);
  const adapter = new ReviewAdapter();
  const ctx = await mount(t, { provider: 'test', model: 'test-model' }, adapter);
  for (const repository of [first, second]) {
    const agent = { session: { header: { cwd: repository.root } } };
    const result = await invoke(ctx, 'start_review', { requirement: 'update index', businessRules: ['new version must survive'] }, agent);
    assert.equal(result.isError, false, JSON.stringify(result));
    assert.equal(result.value.confirmedIssues, 1);
    const status = await invoke(ctx, 'check_review_status', { sessionId: result.value.sessionId }, agent);
    assert.equal(status.isError, false, JSON.stringify(status));
  }
  assert.equal(adapter.calls.length, 4);
  const fixedCtx = await mount(t, { cwd: first.root, provider: 'test', model: 'test-model' }, new ReviewAdapter());
  const result = await invoke(fixedCtx, 'start_review', { requirement: 'update index' }, { session: { header: { cwd: 'nonexistent-session-path' } } });
  assert.equal(result.isError, false, JSON.stringify(result));
});

test('test execution and issue disposition require approval, unavailable approval fails closed', async t => {
  const f = await fixture(t); const ctx = await mount(t, { cwd: f.root, provider: 'test', model: 'test-model' }, new ReviewAdapter());
  const testResult = await invoke(ctx, 'recheck', { sessionId: 'fake', executeTests: true }); assert.equal(testResult.isError, true);
  const disposition = await invoke(ctx, 'set_review_issue_status', { sessionId: 'fake', issueId: 'ISS-001', action: 'wont_fix', reason: 'accept' });
  assert.equal(disposition.isError, true);
});

test('LLM terminal failure does not become a successful empty review', async t => {
  class Failed extends LlmAdapter { async *stream() { yield { type: 'finish', reason: { kind: 'error', failure: { code: 'AUTH', message: 'test auth failure' } } }; } }
  const f = await fixture(t); const ctx = await mount(t, { cwd: f.root, provider: 'test', model: 'test-model' }, new Failed());
  const model = new HarnessModelClient(ctx, { provider: 'test', model: 'test-model' });
  await assert.rejects(model.complete({ phase: 'scan', system: 'system', prompt: 'prompt' }), /AUTH|did not complete/);
});
