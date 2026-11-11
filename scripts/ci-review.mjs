#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { GitService, ReviewService, ReportGenerator, riskSummary } from '../dist/core.js';
import { DeepSeekModelClient } from '../dist/services/deepseek-model.js';

try {
  const { values } = parseArgs({ options: {
    cwd: { type: 'string' }, target: { type: 'string', default: 'working' }, requirement: { type: 'string', default: '' },
    'business-rules': { type: 'string', multiple: true }, 'output-json': { type: 'string' }, config: { type: 'string' },
    'exit-code': { type: 'boolean', default: false }, 'fail-on-needs-check': { type: 'boolean', default: false },
    model: { type: 'string', default: 'deepseek-chat' }, 'api-base': { type: 'string', default: 'https://api.deepseek.com' },
    'max-tokens': { type: 'string', default: '3000' }, help: { type: 'boolean' },
  } });
  if (values.help) {
    console.log('dsh-review --cwd <repo> --target <branch|working> --requirement <text> --business-rules <rule> --output-json <path> [--config <json>] [--exit-code] [--fail-on-needs-check]\nDEEPSEEK_API_KEY is required. Exit codes: 0 analysis finished, 1 requested finding gate, 2 failed/incomplete.');
  } else {
    const config = values.config ? JSON.parse(await readFile(path.resolve(values.config), 'utf8')) : {};
    if (!config || typeof config !== 'object' || Array.isArray(config)) throw new Error('Config must be a JSON object');
    const key = process.env.DEEPSEEK_API_KEY;
    if (!key) throw new Error('Set DEEPSEEK_API_KEY in the process environment');
    const repository = await new GitService(path.resolve(values.cwd ?? '.')).root();
    const model = new DeepSeekModelClient(key, values.model, values['api-base'], Number(values['max-tokens']));
    // Explicitly select allowed review configuration; CI never executes tests.
    const options = Object.fromEntries(['maxCandidates', 'maxPromptChars', 'modelTimeoutMs', 'customRules', 'learningMode'].filter(k => k in config).map(k => [k, config[k]]));
    const service = new ReviewService(repository, model, options);
    const result = await service.startReview(values.target, { requirement: values.requirement,
      businessRules: (values['business-rules'] ?? []).flatMap(s => s.split(',')).map(s => s.trim()).filter(Boolean), outOfScope: config.outOfScope ?? [] });
    const session = await service.storage.loadSession(result.sessionId);
    const report = { ...session, ...riskSummary(session), modelUsage: model.usage };
    const output = path.resolve(values['output-json'] ?? path.join(repository, '.dsh-review', `${result.sessionId}.ci.json`));
    await mkdir(path.dirname(output), { recursive: true });
    await writeFile(output, JSON.stringify(report, null, 2));
    await writeFile(output.replace(/\.json$/i, '') + '.md', new ReportGenerator().generateMarkdown(session));
    console.log(JSON.stringify({ sessionId: result.sessionId, status: result.status, output,
      confirmedIssues: result.confirmedIssues, needsCheck: result.needsCheck, ...riskSummary(session) }));
    process.exitCode = ['failed', 'cancelled', 'in_progress'].includes(result.status) || result.status === 'needs_human' || session.stale ? 2
      : (values['exit-code'] && result.confirmedIssues > 0) || (values['fail-on-needs-check'] && result.needsCheck > 0) ? 1 : 0;
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 2;
}
