import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const script = path.join(project, 'scripts/evaluation/score.mjs');

function runScore(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [script, ...args], { cwd: project, windowsHide: true });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8').on('data', chunk => { stdout += chunk; });
    child.stderr.setEncoding('utf8').on('data', chunk => { stderr += chunk; });
    child.once('error', reject);
    child.once('close', code => resolve({ code, stdout, stderr }));
  });
}

async function tempInputs(t, runs, adjudications) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'dsh-score-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const runsPath = path.join(dir, 'runs.json');
  const adjudicationsPath = path.join(dir, 'adjudications.json');
  const outputPath = path.join(dir, 'result.json');
  await writeFile(runsPath, JSON.stringify(runs, null, 2));
  await writeFile(adjudicationsPath, JSON.stringify(adjudications, null, 2));
  return { dir, runsPath, adjudicationsPath, outputPath };
}

const fixtureDir = path.join(project, 'tests/fixtures/evaluation-scoring');
const runs = JSON.parse(await readFile(path.join(fixtureDir, 'runs.json'), 'utf8'));
const adjudications = JSON.parse(await readFile(path.join(fixtureDir, 'adjudications.json'), 'utf8'));

test('calculates precision and known-defect discovery from adjudicated completed runs', async t => {
  const files = await tempInputs(t, runs, adjudications);
  const result = await runScore(['--runs', files.runsPath, '--adjudications', files.adjudicationsPath, '--output', files.outputPath]);
  assert.equal(result.code, 0, result.stderr);
  const report = JSON.parse(await readFile(files.outputPath, 'utf8'));
  assert.equal(report.groups.byArm.plugin.precision.value, 2 / 3);
  assert.equal(report.groups.byArm.plugin.knownDefectDiscovery.value, 1 / 2);
  assert.equal(report.groups.byArm.plugin.confirmedClaims, 3);
  assert.equal(report.groups.byArm.plugin.needsCheckClaims, 1);
  assert.equal(report.groups.byArm.plugin.calls, 3);
  assert.equal(report.groups.byArm.plugin.inputTokens, 100);
  assert.equal(report.groups.byArm.plugin.unknownInputTokenRuns, 1);
  assert.equal(report.groups.byArm.plugin.latencyMs.median, 1000);
  assert.equal(report.groups.byArm.plugin.latencyMs.max, 1200);
  assert.equal(report.runs[0].modelRequested, 'model-a');
  assert.equal(report.runs[0].modelReturned, 'model-a');
  assert.equal(report.runs[0].configHash, 'cfg');
  assert.equal(report.runs[0].codeHash, 'code');
  assert.equal(report.runs[0].contextHash, 'ctx');
  assert.match(await readFile(path.join(files.dir, 'result.md'), 'utf8'), /2\/3/);
});

test('case IDs that match object property names are grouped normally', async t => {
  const unusualRuns = runs.map(run => ({ ...run, caseId: '__proto__' }));
  const files = await tempInputs(t, unusualRuns, adjudications);
  const result = await runScore(['--runs', files.runsPath, '--adjudications', files.adjudicationsPath, '--output', files.outputPath]);
  assert.equal(result.code, 0, result.stderr);
  const report = JSON.parse(await readFile(files.outputPath, 'utf8'));
  assert.equal(report.groups.byCaseAndArm['__proto__ / plugin'].runs, 2);
});

test('an unavailable Markdown output leaves no partial JSON or temporary files', async t => {
  const files = await tempInputs(t, runs, adjudications);
  await mkdir(path.join(files.dir, 'result.md'));
  const result = await runScore(['--runs', files.runsPath, '--adjudications', files.adjudicationsPath, '--output', files.outputPath]);
  assert.notEqual(result.code, 0);
  await assert.rejects(readFile(files.outputPath));
  assert.deepEqual((await readdir(files.dir)).sort(), ['adjudications.json', 'result.md', 'runs.json']);
});

test('existing outputs are never replaced', async t => {
  const files = await tempInputs(t, runs, adjudications);
  const oldReport = 'earlier result';
  await writeFile(files.outputPath, oldReport);
  const result = await runScore(['--runs', files.runsPath, '--adjudications', files.adjudicationsPath, '--output', files.outputPath]);
  assert.notEqual(result.code, 0);
  assert.equal(await readFile(files.outputPath, 'utf8'), oldReport);
  await assert.rejects(readFile(path.join(files.dir, 'result.md')));
});

test('empty inputs have no inferred quality score or latency', async t => {
  const files = await tempInputs(t, [], []);
  const result = await runScore(['--runs', files.runsPath, '--adjudications', files.adjudicationsPath, '--output', files.outputPath]);
  assert.equal(result.code, 0, result.stderr);
  const report = JSON.parse(await readFile(files.outputPath, 'utf8'));
  assert.equal(report.totals.completionRate.value, null);
  assert.equal(report.totals.precision.value, null);
  assert.equal(report.totals.latencyMs.median, null);
  assert.equal(report.totals.latencyMs.max, null);
});

test('keeps failed runs visible and reports zero denominators and missing tokens as N/A or unknown', async t => {
  const files = await tempInputs(t, runs, adjudications);
  const result = await runScore(['--runs', files.runsPath, '--adjudications', files.adjudicationsPath, '--output', files.outputPath]);
  assert.equal(result.code, 0, result.stderr);
  const report = JSON.parse(await readFile(files.outputPath, 'utf8'));
  assert.equal(report.totals.runs, 3);
  assert.equal(report.totals.failed, 1);
  assert.equal(report.totals.completionRate.value, 2 / 3);
  assert.equal(report.groups.byArm['with-requirements'].precision.value, null);
  assert.equal(report.groups.byArm['with-requirements'].knownDefectDiscovery.value, null);
  assert.equal(report.totals.unknownInputTokenRuns, 1);
  assert.equal(report.totals.unknownOutputTokenRuns, 1);
  const markdown = await readFile(path.join(files.dir, 'result.md'), 'utf8');
  assert.match(markdown, /N\/A/);
  assert.match(markdown, /failed-1/);
});

test('labels synthetic fixture output explicitly', async t => {
  const files = await tempInputs(t, runs, adjudications);
  const result = await runScore(['--runs', files.runsPath, '--adjudications', files.adjudicationsPath, '--output', files.outputPath, '--synthetic']);
  assert.equal(result.code, 0, result.stderr);
  assert.equal(JSON.parse(await readFile(files.outputPath, 'utf8')).label, '统计器测试数据');
  assert.match(await readFile(path.join(files.dir, 'result.md'), 'utf8'), /统计器测试数据/);
});

test('rejects duplicate run IDs', async t => {
  const files = await tempInputs(t, [...runs, runs[0]], adjudications);
  const result = await runScore(['--runs', files.runsPath, '--adjudications', files.adjudicationsPath, '--output', files.outputPath]);
  assert.notEqual(result.code, 0);
  assert.match(result.stderr, /duplicate runId/i);
  await assert.rejects(readFile(files.outputPath));
});

test('rejects missing adjudications and invalid count relationships without writing output', async t => {
  const missing = await tempInputs(t, runs, adjudications.slice(0, 2));
  const missingResult = await runScore(['--runs', missing.runsPath, '--adjudications', missing.adjudicationsPath, '--output', missing.outputPath]);
  assert.notEqual(missingResult.code, 0);
  assert.match(missingResult.stderr, /missing adjudication/i);
  await assert.rejects(readFile(missing.outputPath));

  const invalid = await tempInputs(t, runs, [{ ...adjudications[0], detectedKnownDefects: 2 }, ...adjudications.slice(1)]);
  const invalidResult = await runScore(['--runs', invalid.runsPath, '--adjudications', invalid.adjudicationsPath, '--output', invalid.outputPath]);
  assert.notEqual(invalidResult.code, 0);
  assert.match(invalidResult.stderr, /detectedKnownDefects/i);
  await assert.rejects(readFile(invalid.outputPath));
});

test('rejects non-null quality counts for failed runs and refuses to overwrite inputs', async t => {
  const invalid = await tempInputs(t, runs, [{ ...adjudications[0] }, { ...adjudications[1] }, { ...adjudications[2], knownDefects: 0 }]);
  const invalidResult = await runScore(['--runs', invalid.runsPath, '--adjudications', invalid.adjudicationsPath, '--output', invalid.outputPath]);
  assert.notEqual(invalidResult.code, 0);
  assert.match(invalidResult.stderr, /failed run/i);

  const before = await readFile(invalid.runsPath, 'utf8');
  const overwriteResult = await runScore(['--runs', invalid.runsPath, '--adjudications', invalid.adjudicationsPath, '--output', invalid.runsPath]);
  assert.notEqual(overwriteResult.code, 0);
  assert.equal(await readFile(invalid.runsPath, 'utf8'), before);

  const markdownCollision = await tempInputs(t, runs, adjudications);
  const collidingJsonOutput = path.join(markdownCollision.dir, 'result.json');
  const collidingMarkdownInput = path.join(markdownCollision.dir, 'result.md');
  const originalMarkdownInput = JSON.stringify(adjudications);
  await writeFile(collidingMarkdownInput, originalMarkdownInput);
  const collisionResult = await runScore(['--runs', markdownCollision.runsPath, '--adjudications', collidingMarkdownInput, '--output', collidingJsonOutput]);
  assert.notEqual(collisionResult.code, 0);
  assert.match(collisionResult.stderr, /must not overwrite/i);
  assert.equal(await readFile(collidingMarkdownInput, 'utf8'), originalMarkdownInput);
  await assert.rejects(readFile(collidingJsonOutput));
});

