#!/usr/bin/env node
import { randomUUID } from 'node:crypto';
import { link, lstat, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ARMS = new Set(['code-only', 'with-requirements', 'plugin']);
const STATUSES = ['completed', 'failed', 'cancelled', 'budget_exceeded'];
const QUALITY_FIELDS = ['knownDefects', 'detectedKnownDefects', 'confirmedClaims', 'validConfirmedClaims', 'needsCheckClaims', 'unsupportedConfirmations'];
const RUN_FIELDS = ['runId', 'caseId', 'arm', 'status', 'modelRequested', 'modelReturned', 'configHash', 'codeHash', 'contextHash', 'calls', 'inputTokens', 'outputTokens', 'elapsedMs'];

function fail(message) { throw new Error(message); }

function parseArgs(args) {
  const options = {};
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === '--synthetic') {
      if (options.synthetic) fail('duplicate option: --synthetic');
      options.synthetic = true;
      continue;
    }
    if (!['--runs', '--adjudications', '--output'].includes(arg)) fail(`unknown option: ${arg}`);
    if (options[arg]) fail(`duplicate option: ${arg}`);
    const value = args[++index];
    if (!value || value.startsWith('--')) fail(`missing value for ${arg}`);
    options[arg] = value;
  }
  for (const name of ['--runs', '--adjudications', '--output']) if (!options[name]) fail(`required option missing: ${name}`);
  return options;
}

function isObject(value) { return value !== null && typeof value === 'object' && !Array.isArray(value); }
function nonEmptyString(value) { return typeof value === 'string' && value.trim().length > 0; }
function nonNegativeNumber(value) { return typeof value === 'number' && Number.isFinite(value) && value >= 0; }
function nonNegativeInteger(value) { return Number.isSafeInteger(value) && value >= 0; }

function validateRuns(runs) {
  if (!Array.isArray(runs)) fail('runs input must be a JSON array');
  const seen = new Set();
  for (const [index, run] of runs.entries()) {
    const label = `runs[${index}]`;
    if (!isObject(run)) fail(`${label} must be an object`);
    for (const field of RUN_FIELDS) if (!(field in run)) fail(`${label}.${field} is required`);
    for (const field of ['runId', 'caseId', 'modelRequested', 'configHash', 'codeHash', 'contextHash']) {
      if (!nonEmptyString(run[field])) fail(`${label}.${field} must be a non-empty string`);
    }
    if (run.modelReturned !== null && !nonEmptyString(run.modelReturned)) fail(`${label}.modelReturned must be a non-empty string or null`);
    if (!ARMS.has(run.arm)) fail(`${label}.arm must be one of ${[...ARMS].join(', ')}`);
    if (!STATUSES.includes(run.status)) fail(`${label}.status must be one of ${STATUSES.join(', ')}`);
    if (!nonNegativeInteger(run.calls)) fail(`${label}.calls must be a non-negative integer`);
    for (const field of ['inputTokens', 'outputTokens']) {
      if (run[field] !== null && !nonNegativeInteger(run[field])) fail(`${label}.${field} must be a non-negative integer or null`);
    }
    if (!nonNegativeNumber(run.elapsedMs)) fail(`${label}.elapsedMs must be a non-negative number`);
    if (seen.has(run.runId)) fail(`duplicate runId: ${run.runId}`);
    seen.add(run.runId);
  }
  return seen;
}

function validateAdjudications(adjudications, runIds, runsById) {
  if (!Array.isArray(adjudications)) fail('adjudications input must be a JSON array');
  const seen = new Set();
  for (const [index, item] of adjudications.entries()) {
    const label = `adjudications[${index}]`;
    if (!isObject(item)) fail(`${label} must be an object`);
    if (!nonEmptyString(item.runId)) fail(`${label}.runId must be a non-empty string`);
    if (seen.has(item.runId)) fail(`duplicate adjudication runId: ${item.runId}`);
    seen.add(item.runId);
    if (!runIds.has(item.runId)) fail(`orphan adjudication runId: ${item.runId}`);
    if (typeof item.notes !== 'string') fail(`${label}.notes must be a string`);
    const run = runsById.get(item.runId);
    for (const field of QUALITY_FIELDS) {
      if (run.status === 'completed') {
        if (!nonNegativeInteger(item[field])) fail(`${label}.${field} must be a non-negative integer for completed runs`);
      } else if (item[field] !== null) {
        fail(`${label}.${field} must be null for a failed run (${item.runId})`);
      }
    }
    if (run.status !== 'completed' && item.notes.trim().length === 0) fail(`${label}.notes must explain why the run did not complete`);
    if (run.status === 'completed') {
      if (item.detectedKnownDefects > item.knownDefects) fail(`${label}.detectedKnownDefects cannot exceed knownDefects`);
      if (item.validConfirmedClaims > item.confirmedClaims) fail(`${label}.validConfirmedClaims cannot exceed confirmedClaims`);
      if (item.unsupportedConfirmations > item.confirmedClaims - item.validConfirmedClaims) {
        fail(`${label}.unsupportedConfirmations cannot exceed confirmedClaims minus validConfirmedClaims`);
      }
    }
  }
  for (const id of runIds) if (!seen.has(id)) fail(`missing adjudication for runId: ${id}`);
  return new Map(adjudications.map(item => [item.runId, item]));
}

function ratio(numerator, denominator) {
  return { numerator, denominator, value: denominator === 0 ? null : numerator / denominator };
}

function median(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function summarize(runs, adjudications) {
  const completed = runs.filter(run => run.status === 'completed');
  const adjudicated = completed.map(run => adjudications.get(run.runId));
  const sum = field => adjudicated.reduce((total, item) => total + item[field], 0);
  const counts = Object.fromEntries(STATUSES.map(status => [status, runs.filter(run => run.status === status).length]));
  const latency = runs.map(run => run.elapsedMs);
  const quality = {
    knownDefects: sum('knownDefects'),
    detectedKnownDefects: sum('detectedKnownDefects'),
    confirmedClaims: sum('confirmedClaims'),
    validConfirmedClaims: sum('validConfirmedClaims'),
    needsCheckClaims: sum('needsCheckClaims'),
    unsupportedConfirmations: sum('unsupportedConfirmations'),
    precision: ratio(sum('validConfirmedClaims'), sum('confirmedClaims')),
    knownDefectDiscovery: ratio(sum('detectedKnownDefects'), sum('knownDefects')),
  };
  return {
    runs: runs.length,
    ...counts,
    completionRate: ratio(counts.completed, runs.length),
    ...quality,
    calls: runs.reduce((total, run) => total + run.calls, 0),
    inputTokens: runs.reduce((total, run) => total + (run.inputTokens ?? 0), 0),
    outputTokens: runs.reduce((total, run) => total + (run.outputTokens ?? 0), 0),
    unknownInputTokenRuns: runs.filter(run => run.inputTokens === null).length,
    unknownOutputTokenRuns: runs.filter(run => run.outputTokens === null).length,
    latencyMs: { values: latency, median: median(latency), max: latency.length ? Math.max(...latency) : null },
  };
}

function buildReport(runs, adjudications, synthetic) {
  const byArm = {};
  const byCaseAndArm = {};
  const runDetails = runs.map(run => {
    const item = adjudications.get(run.runId);
    const groupKey = JSON.stringify([run.caseId, run.arm]);
    byCaseAndArm[groupKey] ??= [];
    byCaseAndArm[groupKey].push(run);
    return {
      runId: run.runId,
      caseId: run.caseId,
      arm: run.arm,
      status: run.status,
      modelRequested: run.modelRequested,
      modelReturned: run.modelReturned,
      configHash: run.configHash,
      codeHash: run.codeHash,
      contextHash: run.contextHash,
      notes: item.notes,
      quality: run.status === 'completed' ? {
        knownDefects: item.knownDefects,
        detectedKnownDefects: item.detectedKnownDefects,
        confirmedClaims: item.confirmedClaims,
        validConfirmedClaims: item.validConfirmedClaims,
        needsCheckClaims: item.needsCheckClaims,
        unsupportedConfirmations: item.unsupportedConfirmations,
        precision: ratio(item.validConfirmedClaims, item.confirmedClaims),
        knownDefectDiscovery: ratio(item.detectedKnownDefects, item.knownDefects),
      } : null,
      resources: { calls: run.calls, inputTokens: run.inputTokens, outputTokens: run.outputTokens, elapsedMs: run.elapsedMs },
    };
  });
  for (const arm of [...new Set(runs.map(run => run.arm))].sort()) byArm[arm] = summarize(runs.filter(run => run.arm === arm), adjudications);
  const byCase = Object.fromEntries(Object.entries(byCaseAndArm).sort(([a], [b]) => a.localeCompare(b)).map(([key, groupRuns]) => {
    const [caseId, arm] = JSON.parse(key);
    return [`${caseId} / ${arm}`, summarize(groupRuns, adjudications)];
  }));
  return {
    schemaVersion: 1,
    ...(synthetic ? { label: '统计器测试数据' } : {}),
    totals: summarize(runs, adjudications),
    groups: { byArm, byCaseAndArm: byCase },
    runs: runDetails,
  };
}

function displayRatio(value) {
  if (value.value === null) return 'N/A';
  return `${value.numerator}/${value.denominator} (${(value.value * 100).toFixed(1)}%)`;
}

function displayLatency(group) {
  return `${group.latencyMs.median ?? 'N/A'} / ${group.latencyMs.max ?? 'N/A'}`;
}

function mdCell(value) {
  return String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
    .replaceAll('|', '\\|').replace(/[\r\n\u0000]/g, ' ');
}

function renderMarkdown(report) {
  const groups = [
    ...Object.entries(report.groups.byArm).map(([arm, group]) => [`overall / ${arm}`, group]),
    ...Object.entries(report.groups.byCaseAndArm),
  ];
  const statusRows = groups.map(([name, group]) =>
    `| ${mdCell(name)} | ${group.runs} | ${group.completed} | ${group.failed} | ${group.cancelled} | ${group.budget_exceeded} | ${displayRatio(group.completionRate)} |`);
  const qualityRows = groups.map(([name, group]) =>
    `| ${mdCell(name)} | ${displayRatio(group.precision)} | ${displayRatio(group.knownDefectDiscovery)} | ${group.needsCheckClaims} | ${group.unsupportedConfirmations} |`);
  const resourceRows = groups.map(([name, group]) =>
    `| ${mdCell(name)} | ${group.calls} | ${group.inputTokens} / ${group.unknownInputTokenRuns} | ${group.outputTokens} / ${group.unknownOutputTokenRuns} | ${displayLatency(group)} |`);
  const detailRows = report.runs.map(run => {
    const quality = run.quality ? `${displayRatio(run.quality.precision)}; ${displayRatio(run.quality.knownDefectDiscovery)}` : 'N/A（未完成）';
    return `| ${mdCell(run.runId)} | ${mdCell(run.caseId)} | ${run.arm} | ${run.status} | ${quality} | ${mdCell(run.notes || '—')} |`;
  });
  const label = report.label ? `> **${report.label}**。合成统计器测试数据，不是模型评测结果。\n\n` : '';
  return `# 离线评测统计\n\n${label}质量指标仅使用 completed runs；失败、取消及预算耗尽仍计入完成率和资源。分母为零显示 N/A。\n\n## 运行状态\n\n| 组别 | 运行 | 完成 | 失败 | 取消 | 预算耗尽 | 完成率 |\n|---|---:|---:|---:|---:|---:|---:|\n${statusRows.join('\n')}\n\n## 质量指标\n\n| 组别 | 确认精确率 | 已知缺陷发现率 | 待核查 | 无依据确认 |\n|---|---:|---:|---:|---:|\n${qualityRows.join('\n')}\n\n## 资源\n\nToken 列格式为已知合计 / token 未知运行数；延迟列为中位数 / 最大值（毫秒）。\n\n| 组别 | 调用 | 输入 tokens | 输出 tokens | 延迟中位数 / 最大值 |\n|---|---:|---:|---:|---:|\n${resourceRows.join('\n')}\n\n## 逐次运行\n\n| runId | 案例 | 组别 | 状态 | 精确率；发现率 | 裁定备注 |\n|---|---|---|---|---|---|\n${detailRows.join('\n')}\n`;
}

function markdownPath(outputPath) {
  const parsed = path.parse(outputPath);
  return path.join(parsed.dir, `${parsed.name}.md`);
}

async function writePair(outputPath, json, markdown) {
  const mdPath = markdownPath(outputPath);
  for (const target of [outputPath, mdPath]) {
    try { await lstat(target); }
    catch (error) { if (error.code === 'ENOENT') continue; throw error; }
    fail(`output already exists: ${target}; use a new output path`);
  }
  const jsonTemp = `${outputPath}.${randomUUID()}.tmp`;
  const mdTemp = `${mdPath}.${randomUUID()}.tmp`;
  const published = [];
  try {
    await writeFile(jsonTemp, json, { flag: 'wx' });
    await writeFile(mdTemp, markdown, { flag: 'wx' });
    // Publish complete files without replacing existing reports; roll back this run on failure.
    await link(jsonTemp, outputPath); published.push(outputPath);
    await link(mdTemp, mdPath); published.push(mdPath);
  } catch (error) {
    await Promise.all(published.map(target => rm(target, { force: true })));
    throw error;
  } finally {
    await Promise.all([rm(jsonTemp, { force: true }), rm(mdTemp, { force: true })]);
  }
}

async function main(args) {
  const options = parseArgs(args);
  const runsPath = path.resolve(options['--runs']);
  const adjudicationsPath = path.resolve(options['--adjudications']);
  const outputPath = path.resolve(options['--output']);
  const mdPath = markdownPath(outputPath);
  if ([runsPath, adjudicationsPath].includes(outputPath) || [runsPath, adjudicationsPath].includes(mdPath)) {
    fail('output JSON/Markdown path must not overwrite either input file');
  }
  if (outputPath === mdPath) fail('JSON and Markdown output paths must differ');

  const [runsText, adjudicationsText] = await Promise.all([readFile(runsPath, 'utf8'), readFile(adjudicationsPath, 'utf8')]);
  let runs;
  let rawAdjudications;
  try { runs = JSON.parse(runsText); } catch (error) { fail(`invalid runs JSON: ${error.message}`); }
  try { rawAdjudications = JSON.parse(adjudicationsText); } catch (error) { fail(`invalid adjudications JSON: ${error.message}`); }
  const runIds = validateRuns(runs);
  const runsById = new Map(runs.map(run => [run.runId, run]));
  const adjudications = validateAdjudications(rawAdjudications, runIds, runsById);
  const report = buildReport(runs, adjudications, options.synthetic === true);
  await writePair(outputPath, `${JSON.stringify(report, null, 2)}\n`, renderMarkdown(report));
  process.stdout.write(`Wrote ${outputPath} and ${mdPath}\n`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch(error => {
    process.stderr.write(`Evaluation scoring failed: ${error.message}\n`);
    process.exitCode = 1;
  });
}
