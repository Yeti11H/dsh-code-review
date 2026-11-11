import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { INITIAL_SCAN_PROMPT } from '../dist/prompts/initial-scan.js';
import { VERIFY_FINDING_PROMPT } from '../dist/prompts/verify-findings.js';

const scratch = fileURLToPath(new URL('../work/', import.meta.url));
export async function fixture(t, content = 'export const value = 1;\n') {
  await mkdir(scratch, { recursive: true });
  const root = await mkdtemp(path.join(scratch, 'case-'));
  t.after(async () => {
    const relative = path.relative(scratch, root);
    if (relative.startsWith('..') || path.isAbsolute(relative) || !path.basename(root).startsWith('case-')) throw new Error('Unsafe test cleanup');
    await rm(root, { recursive: true, force: true, maxRetries: 5 });
  });
  const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', windowsHide: true });
  git('init', '-q', '-b', 'main');
  git('config', 'user.email', 'test@example.invalid'); git('config', 'user.name', 'Review tests');
  git('config', 'core.autocrlf', 'false');
  await writeFile(path.join(root, 'index.js'), content);
  git('add', '.'); git('commit', '-qm', 'base');
  return { root, git, write: async (name, text) => { await mkdir(path.dirname(path.join(root, name)), { recursive: true }); await writeFile(path.join(root, name), text); } };
}

export const context = { requirement: '更新知识索引', businessRules: ['旧版本不得替换已发布的新版本'], outOfScope: [] };
export const bug = 'export async function update(event, loadVersion, publish) {\n  if (event.version < await loadVersion()) return;\n  await publish(event);\n}\n';
export const fixed = 'export async function update(event, loadVersion, publish) {\n  if (event.version < await loadVersion()) return;\n  await publish(event, { onlyIfNewer: true });\n}\n';
export const candidate = (title = '旧写入覆盖新版本', file = 'index.js') => ({ id: 'FD-001',
  location: { file, lineRange: [3, 3], side: 'after' }, description: title,
  reasoning: '检查和写入分离，存在竞争窗口', verification_points: ['publish 的条件写入实现'], business_dependent: false });

export const verified = (overrides = {}) => ({ verdict: 'confirmed', title: '旧写入覆盖新版本',
  location: { file: 'index.js', lineRange: [3, 3], side: 'after' },
  trigger_condition: 'v3 resumes after v4 has published', error_process: 'v3 检查后暂停，v4 发布，v3 覆盖',
  actual_impact: '用户检索到旧内容', code_evidence: [{ file: 'index.js', lineRange: [3, 3], side: 'after', quote: '  await publish(event);' }],
  verification_status: 'code_analysis_only', verification_method: '控制两个任务的执行顺序', suggested_fix: '条件发布或版本隔离',
  category: 'correctness', priority: 'high', optional: false, origin: 'introduced',
  business_dependent: false, rationale: '写入未带版本条件，检查与写入分离', resolved: false, ...overrides });

export function scripted(handler) {
  const calls = [];
  return { calls, async complete(request, signal) {
    signal?.throwIfAborted();
    const prefix = request.phase === 'scan' ? INITIAL_SCAN_PROMPT : VERIFY_FINDING_PROMPT;
    const input = JSON.parse(request.prompt.slice(prefix.length));
    calls.push({ phase: request.phase, input });
    const result = await handler(request.phase, input, calls.length);
    return typeof result === 'string' ? result : JSON.stringify(result);
  } };
}

export const raceModel = () => scripted(phase => phase === 'scan' ? [candidate()] : verified());
