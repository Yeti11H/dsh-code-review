import { randomUUID } from 'node:crypto';
import path from 'node:path';
import type { ChangeSnapshot, FileChange, Finding, ModelClient, ModelRequest, ReviewContext,
  ReviewOptions, ReviewResult, ReviewRound, ReviewSession, TestResult, VerifiedIssue } from '../types.js';
import { GitService, calculateHash, changedSources, incrementalFiles } from './git.js';
import { calculateRiskScore, riskSummary } from './risk.js';
import { scanRules, validateRules } from './rules.js';
import { StorageService } from './storage.js';
import { ReportGenerator } from './reporter.js';
import { parseFindings, parseJSON, verifyResponse } from './evidence.js';
import { INITIAL_SCAN_PROMPT, REVIEW_SYSTEM } from '../prompts/initial-scan.js';
import { VERIFY_FINDING_PROMPT } from '../prompts/verify-findings.js';
import { runProcess } from './process.js';

export class ReviewService {
  readonly git: GitService;
  readonly storage: StorageService;
  readonly reporter = new ReportGenerator();

  constructor(public readonly repository: string, private readonly model: ModelClient, private readonly options: ReviewOptions = {}) {
    this.git = new GitService(repository, options);
    this.storage = new StorageService(repository);
    validateRules(options.customRules);
    if (options.learningMode !== undefined && typeof options.learningMode !== 'boolean') throw new Error('learningMode must be boolean');
    for (const key of ['maxChangedLines', 'maxFileBytes', 'maxSnapshotBytes', 'maxSourceFiles', 'maxPromptChars', 'maxCandidates', 'modelTimeoutMs', 'testTimeoutMs'] as const) {
      const value = options[key];
      if (value !== undefined && (!Number.isInteger(value) || value < 1)) throw new Error(`${key} must be a positive integer`);
    }
    if ((options.maxPromptChars ?? 90_000) < 4000) throw new Error('maxPromptChars must be at least 4000');
  }

  async startReview(target: string, context: ReviewContext, signal?: AbortSignal): Promise<ReviewResult> {
    return this.storage.withLock(async () => {
      this.validateContext(context);
      const snapshot = await this.stableSnapshot(target, signal);
      const session: ReviewSession = { schemaVersion: 1, id: `RV-${randomUUID()}`, repository: this.repository,
        snapshot, context, rounds: [], calls: [], status: 'in_progress', stale: false, createdAt: Date.now() };
      await this.storage.saveSession(session);
      try {
        await this.runRound(session, snapshot, snapshot.files, undefined, false, signal);
        return await this.finish(session, signal);
      } catch (error) { return this.failure(session, error, signal); }
    });
  }

  async recheck(id: string, executeTests = false, signal?: AbortSignal): Promise<ReviewResult> {
    return this.storage.withLock(async () => {
      const session = await this.storage.loadSession(id);
      const current = await this.stableSnapshot(session.snapshot.target, signal);
      const previous = session.rounds.at(-1);
      if (previous?.codeHash === current.hash && !executeTests && (session.status === 'completed' || session.status === 'needs_human')) {
        session.stale = false;
        await this.save(session);
        return this.result(session, '代码未变化，无需复查；保留原审查状态。');
      }
      if (executeTests && !this.options.testCommands?.length) throw new Error('Test execution is not configured by the installer');
      session.status = 'in_progress'; session.stale = false; delete session.error;
      await this.storage.saveSession(session);
      try {
        const files = previous ? incrementalFiles(previous.snapshot, current) : current.files;
        await this.runRound(session, current, files, previous, executeTests, signal);
        return await this.finish(session, signal);
      } catch (error) { return this.failure(session, error, signal); }
    });
  }

  async checkStatus(id?: string, signal?: AbortSignal): Promise<ReviewResult | Awaited<ReturnType<StorageService['listSessions']>>> {
    if (!id) return this.storage.listSessions();
    const session = await this.storage.loadSession(id);
    session.stale = (await this.git.getChanges(session.snapshot.target, signal)).hash !== (session.rounds.at(-1)?.codeHash ?? session.snapshot.hash);
    if (session.stale && session.status === 'completed') session.status = 'needs_human';
    return this.result(session);
  }

  async disposition(id: string, issueId: string, action: 'wont_fix' | 'reopen' | 'false_positive', reason: string): Promise<ReviewResult> {
    if (!reason.trim() || reason.length > 2000) throw new Error('A reason is required, at most 2000 characters');
    return this.storage.withLock(async () => {
      const session = await this.storage.loadSession(id);
      const issue = session.rounds.at(-1)?.issues.find(i => i.id === issueId);
      if (!issue) throw new Error('Issue not found');
      const memory = (await this.storage.loadLearnings()).filter(l => l.sessionId !== id || l.issueId !== issueId);
      if (this.options.learningMode && action !== 'reopen') {
        const evidence = issue.code_evidence.find(e => e.side !== 'before' && e.quote.trim().length >= 8);
        const pattern = evidence?.quote.split('\n').find(line => line.trim().length >= 8)?.slice(0, 300);
        if (evidence && pattern) memory.push({ sessionId: id, issueId, file: evidence.file, codePattern: pattern,
          contextHash: calculateHash(JSON.stringify(session.context)), action, reason, addedAt: new Date().toISOString() });
      }
      issue.status = action === 'wont_fix' ? 'wont_fix' : action === 'false_positive' ? 'resolved' : 'open';
      if (action === 'false_positive') issue.verdict = 'false_positive';
      if (action === 'reopen' && issue.verdict === 'false_positive') { issue.verdict = 'needs_check'; issue.verification_status = 'needs_manual_check'; }
      issue.rationale += `；用户处置（${new Date().toISOString()}）：${action}：${reason}`;
      await this.storage.saveLearnings(memory);
      await this.save(session);
      return this.result(session, '已记录处置及原因；这不代表合并批准。');
    });
  }

  private validateContext(context: ReviewContext): void {
    if (typeof context.requirement !== 'string' || !Array.isArray(context.businessRules) || !Array.isArray(context.outOfScope)
      || ![...context.businessRules, ...context.outOfScope].every(v => typeof v === 'string')) throw new Error('Invalid review context');
    if (JSON.stringify(context).length > 16_000) throw new Error('Business context exceeds 16000 characters');
  }

  private async stableSnapshot(target: string, signal?: AbortSignal): Promise<ChangeSnapshot> {
    const first = await this.git.getChanges(target, signal);
    const second = await this.git.getChanges(target, signal);
    if (first.hash !== second.hash) throw new Error('Source changed while capturing snapshot; retry after edits stop');
    return second;
  }

  private async call(session: ReviewSession, request: ModelRequest, signal?: AbortSignal): Promise<unknown> {
    if (request.prompt.length + request.system.length > (this.options.maxPromptChars ?? 90_000)) throw new Error('Prompt budget exceeded; reduce batch size or business context');
    const call = { ...request, id: randomUUID(), timestamp: Date.now() } as ReviewSession['calls'][number];
    session.calls.push(call);
    await this.storage.saveSession(session);
    const timeoutSignal = AbortSignal.timeout(this.options.modelTimeoutMs ?? 120_000);
    const combined = signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal;
    try {
      combined.throwIfAborted();
      const output = await new Promise<string>((resolve, reject) => {
        const abort = () => reject(combined.reason);
        combined.addEventListener('abort', abort, { once: true });
        this.model.complete(request, combined).then(resolve, reject).finally(() => combined.removeEventListener('abort', abort));
      });
      call.response = output;
      return parseJSON(output);
    } catch (error) {
      call.error = error instanceof Error ? error.message : String(error);
      throw error;
    } finally { await this.storage.saveSession(session); }
  }

  private buildContext(snapshot: ChangeSnapshot, file: string, line: [number, number], hint: string): { text: string; files: string[]; notes: string[] } {
    const limit = Math.floor((this.options.maxPromptChars ?? 90_000) / 2);
    const main = this.git.getContext(snapshot, file, line);
    const old = snapshot.before[file] !== undefined ? this.git.getContext(snapshot, file, line, 'before') : '';
    const primary = snapshot.sources[file] ?? snapshot.before[file] ?? '';
    const tokens = [...new Set([...primary.matchAll(/(?:function\s+|class\s+|(?:export\s+)?(?:async\s+)?)([A-Za-z_$][\w$]{3,})\s*\(/g)].map(m => m[1]!).slice(0, 16))];
    const imported = [...primary.matchAll(/(?:from\s+|require\s*\()\s*['"]([^'"]+)['"]/g)].map(m => m[1]!);
    const related = Object.keys(snapshot.sources).filter(f => f !== file).map(f => {
      const body = snapshot.sources[f]!;
      const score = tokens.filter(t => body.includes(t)).length + imported.filter(i => i.startsWith('.') && path.posix.normalize(path.posix.join(path.posix.dirname(file), i)).replace(/\.[^.]+$/, '') === f.replace(/\.[^.]+$/, '')).length * 5
        + (hint.includes(f) ? 5 : 0);
      return { file: f, score };
    }).filter(f => f.score > 0).sort((a, b) => b.score - a.score).slice(0, 6);
    let text = [main, old].filter(Boolean).join('\n\n');
    const files = [file]; const notes: string[] = [];
    if (text.length > limit) { text = text.slice(0, limit); notes.push(`${file}: primary context truncated`); }
    for (const candidate of related) {
      const body = snapshot.sources[candidate.file]!;
      const lines = body.split('\n');
      const index = Math.max(0, lines.findIndex(l => tokens.some(t => l.includes(t))));
      const context = this.git.getContext(snapshot, candidate.file, [index + 1, index + 1]);
      if (text.length + context.length > limit) { notes.push(`${candidate.file}: related context exceeds prompt budget`); continue; }
      text += '\n\n' + context; files.push(candidate.file);
    }
    return { text, files, notes };
  }

  private async verify(session: ReviewSession, snapshot: ChangeSnapshot, finding: Finding, round: number,
    prior: VerifiedIssue | undefined, signal?: AbortSignal): Promise<{ issue: VerifiedIssue; resolved: boolean; notes: string[] }> {
    const context = this.buildContext(snapshot, finding.location.file, finding.location.lineRange, finding.verification_points.join('\n'));
    const raw = await this.call(session, { phase: 'verify', system: REVIEW_SYSTEM,
      prompt: VERIFY_FINDING_PROMPT + JSON.stringify({ context: session.context, finding, priorIssue: prior ?? null,
        codeContext: context.text, historicalFeedback: await this.feedback(session, snapshot),
        scopeLimitations: [...snapshot.omissions, ...context.notes] }) }, signal);
    const result = verifyResponse(raw, finding, snapshot, context.files,
      !session.context.requirement.trim() || session.context.businessRules.length === 0, round);
    return { ...result, notes: context.notes };
  }

  private async feedback(session: ReviewSession, snapshot: ChangeSnapshot) {
    if (!this.options.learningMode) return [];
    const hash = calculateHash(JSON.stringify(session.context));
    return (await this.storage.loadLearnings()).filter(l => l.contextHash === hash && snapshot.sources[l.file]?.includes(l.codePattern))
      .slice(-10).map(l => ({ file: l.file, codePattern: l.codePattern, action: l.action, reason: l.reason,
        instruction: '用户历史反馈仅供核查；接受风险不是安全证明，不得据此忽略新证据。' }));
  }

  private async runRound(session: ReviewSession, snapshot: ChangeSnapshot, files: FileChange[], previous: ReviewRound | undefined,
    executeTests: boolean, signal?: AbortSignal): Promise<void> {
    const number = session.rounds.length + 1;
    const changes = previous ? changedSources(previous.snapshot, snapshot) : files.map(f => f.file);
    const issues: VerifiedIssue[] = previous ? structuredClone(previous.issues) : [];
    const notes: string[] = ['相关调用与测试采用词法搜索和有界代码窗口，未进行完整 AST 或全程序分析。',
      '模型生成的代码依据已核对原文；触发条件和影响仍可能判断错误。'];
    const scanned = new Set<string>();
    const omissions = [...snapshot.omissions];
    const ruleScan = await scanRules(snapshot, files, this.options.customRules, signal);
    omissions.push(...ruleScan.notes);
    const ruleMatches = ruleScan.matches;
    const historicalFeedback = await this.feedback(session, snapshot);
    if (historicalFeedback.length) notes.push(`本轮参考 ${historicalFeedback.length} 条同上下文且原文仍匹配的人工反馈；不自动抑制问题。`);
    const missingBusiness = !session.context.requirement.trim() || session.context.businessRules.length === 0;
    if (missingBusiness) notes.push('需求或业务规则不完整；涉及业务预期的结论需要人工确认。');

    if (previous) {
      for (const issue of issues) {
        if (issue.status !== 'open' || !issue.dependencies.some(f => changes.includes(f))) continue;
        const finding: Finding = { id: issue.id, location: issue.location, description: issue.title, reasoning: issue.rationale,
          verification_points: issue.dependencies, business_dependent: issue.business_dependent };
        const verified = await this.verify(session, snapshot, finding, number, issue, signal);
        notes.push(...verified.notes);
        if (verified.issue.verdict === 'false_positive' && !verified.resolved) {
          verified.issue.verdict = 'needs_check'; verified.issue.status = 'open';
          verified.issue.verification_status = 'needs_manual_check';
          verified.issue.rationale += '；缺少当前代码支持的修复证明，保留待核查';
        }
        Object.assign(issue, verified.issue, { id: issue.id, fingerprint: issue.fingerprint, firstSeenRound: issue.firstSeenRound,
          status: verified.resolved ? 'resolved' : 'open', lastSeenRound: number });
      }
    }

    let nextId = Math.max(0, ...issues.map(i => Number(i.id.split('-')[1]) || 0)) + 1;
    const newIds: string[] = [];
    for (const batch of this.git.splitLargeChanges(files)) {
      signal?.throwIfAborted();
      const allowed = new Set(batch.map(f => f.file));
      const batchCode = batch.map(f => {
        scanned.add(f.file);
        const hunk = /@@ -\d+(?:,\d+)? \+(\d+)/.exec(f.diff);
        const line = Math.max(1, Number(hunk?.[1] ?? 1));
        let context = this.git.getContext(snapshot, f.file, [line, line]);
        if (context.length > 6000) { context = context.slice(0, 6000); omissions.push(`${f.file}: scan code window truncated`); }
        return { file: f.file, diff: f.diff, numberedContext: context };
      });
      const max = this.options.maxCandidates ?? 20;
      const raw = await this.call(session, { phase: 'scan', system: REVIEW_SYSTEM,
        prompt: INITIAL_SCAN_PROMPT + JSON.stringify({ context: session.context, maxCandidates: max, changes: batchCode,
          customRuleMatches: ruleMatches.filter(m => allowed.has(m.file)), historicalFeedback,
          previousIssues: issues.map(i => ({ id: i.id, title: i.title, location: i.location, status: i.status })),
          instructions: '不要重复已有问题。原问题的修复验证由独立流程处理。' }) }, signal);
      const findings = parseFindings(raw, max);
      for (const finding of findings) {
        if (!allowed.has(finding.location.file)) throw new Error(`Candidate outside current batch: ${finding.location.file}`);
        const verified = await this.verify(session, snapshot, finding, number, undefined, signal);
        notes.push(...verified.notes);
        const issue = verified.issue;
        issue.customRuleNames = [...new Set(ruleMatches.filter(m => m.file === issue.location.file
          && m.lineRange[0] >= issue.location.lineRange[0] && m.lineRange[0] <= issue.location.lineRange[1]).map(m => m.name))];
        const existing = issues.find(i => i.fingerprint === issue.fingerprint
          || (i.location.file === issue.location.file && i.category === issue.category && i.trigger_condition === issue.trigger_condition && !!i.trigger_condition)
          || (i.location.file === issue.location.file && i.category === issue.category && i.code_evidence.length > 0 && JSON.stringify(i.code_evidence) === JSON.stringify(issue.code_evidence)));
        if (existing) {
          // Reintroduced findings reopen previously resolved issues under their stable ID.
          // Explicitly accepted risks stay accepted until a human reopens them.
          if (existing.status === 'resolved' && issue.status === 'open') {
            const identity = { id: existing.id, fingerprint: existing.fingerprint, firstSeenRound: existing.firstSeenRound };
            Object.assign(existing, issue, identity, { lastSeenRound: number });
            newIds.push(existing.id);
          }
          continue;
        }
        issue.id = `ISS-${String(nextId++).padStart(3, '0')}`;
        issues.push(issue);
        if (issue.status === 'open') newIds.push(issue.id);
      }
    }
    const tests: TestResult[] = [];
    if (executeTests) {
      if (snapshot.target !== 'unstaged' && snapshot.target !== 'working') {
        const working = await this.git.getChanges('unstaged', signal);
        if (changedSources(snapshot, working).length || working.omissions.length) {
          throw new Error('Cannot test a committed branch snapshot against a different working tree; commit/stash source changes first');
        }
      }
      for (const command of this.options.testCommands ?? []) {
        const result = await runProcess(command.file, command.args, this.repository, signal, this.options.testTimeoutMs ?? 60_000, 1_000_000);
        tests.push({ ...command, ...result, timestamp: Date.now(), codeHash: snapshot.hash });
      }
      notes.push('测试结果仅证明这些命令的运行结果，不自动将每个问题标成已复现或已修复。');
    }
    const resolved = issues.filter(i => i.status === 'resolved' && previous?.issues.some(old => old.id === i.id && old.status === 'open')).map(i => i.id);
    const unchanged = issues.filter(i => i.status === 'open' && !newIds.includes(i.id)).map(i => i.id);
    session.rounds.push({ roundNumber: number, timestamp: Date.now(), codeHash: snapshot.hash, snapshot, issues, ruleMatches,
      newIssuesCount: newIds.length, resolvedIssuesCount: resolved.length,
      coverage: { files: [...scanned], omissions: [...new Set(omissions)], notes: [...new Set(notes)] }, tests,
      changes: { resolved, newIssues: newIds, unchanged } });
    session.status = this.needsHuman(session) ? 'needs_human' : 'completed';
  }

  private needsHuman(session: ReviewSession): boolean {
    const latest = session.rounds.at(-1)!;
    if (latest.coverage.omissions.length) return true;
    if (latest.tests.some(t => t.exitCode !== 0)) return true;
    if (!latest.issues.some(i => i.status === 'open' && (!i.optional || i.verdict === 'needs_check'))) return false;
    const distinct = session.rounds.filter((r, i, all) => i === 0 || r.codeHash !== all[i - 1]!.codeHash);
    const rounds = distinct.slice(-3);
    if (rounds.length < 3) return false;
    const open = rounds.map(r => r.issues.filter(i => i.status === 'open' && (!i.optional || i.verdict === 'needs_check')).length);
    return rounds.every(r => r.newIssuesCount > 0) || (open[0]! <= open[1]! && open[1]! <= open[2]!);
  }

  private async finish(session: ReviewSession, signal?: AbortSignal): Promise<ReviewResult> {
    const current = await this.git.getChanges(session.snapshot.target, signal);
    session.stale = current.hash !== session.rounds.at(-1)!.codeHash;
    if (session.stale) session.status = 'needs_human';
    await this.save(session);
    return this.result(session);
  }

  private async failure(session: ReviewSession, error: unknown, signal?: AbortSignal): Promise<ReviewResult> {
    session.status = signal?.aborted ? 'cancelled' : 'failed';
    session.error = error instanceof Error ? error.message : String(error);
    await this.save(session);
    return this.result(session, '审查未完成，请查看错误和未验证范围。');
  }

  private async save(session: ReviewSession): Promise<void> {
    for (const round of session.rounds) for (const issue of round.issues) issue.riskScore = calculateRiskScore(issue);
    await this.storage.saveSession(session);
    await this.storage.write(`${session.id}.md`, this.reporter.generateMarkdown(session));
  }

  private result(session: ReviewSession, message = ''): ReviewResult {
    const issues = session.rounds.at(-1)?.issues.filter(i => i.status === 'open') ?? [];
    return { sessionId: session.id, status: session.status, reportPath: path.join(this.storage.directory, `${session.id}.md`),
      overallRiskScore: riskSummary(session).overallRiskScore, recommendation: riskSummary(session).recommendation,
      confirmedIssues: issues.filter(i => i.verdict === 'confirmed' && !i.optional).length,
      needsCheck: issues.filter(i => i.verdict === 'needs_check').length,
      optionalSuggestions: issues.filter(i => i.optional && i.verdict !== 'needs_check').length,
      message: message || this.reporter.getNextSteps(session), report: this.reporter.generateMarkdown(session) };
  }
}
