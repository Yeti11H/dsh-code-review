import { randomUUID } from 'node:crypto';
import { GitService } from '../services/git.js';
import { StorageService } from '../services/storage.js';
import { ReportGenerator } from '../services/reporter.js';
import { location, object, parseFindings, verifyResponse } from '../services/evidence.js';
import { reviewContextHash } from '../services/review-context.js';
import { riskSummary } from '../services/risk.js';
import { INITIAL_SCAN_PROMPT } from '../prompts/initial-scan.js';
import { VERIFY_FINDING_PROMPT } from '../prompts/verify-findings.js';
function texts(value, name) {
    if (!Array.isArray(value) || !value.every(s => typeof s === 'string' && s.trim()))
        throw new Error(`${name} must be an array of non-empty strings`);
    return [...new Set(value)];
}
function contextInput(value) {
    const v = object(value);
    if (typeof v.requirement !== 'string')
        throw new Error('requirement must be a string');
    const context = { requirement: v.requirement, businessRules: texts(v.businessRules, 'businessRules'), outOfScope: texts(v.outOfScope, 'outOfScope') };
    if (JSON.stringify(context).length > 16_000)
        throw new Error('Business context exceeds 16000 characters');
    return context;
}
/** Offline host-model adapter. No ModelClient or network operation is used. */
export class CodexReview {
    repository;
    git;
    storage;
    constructor(repository) {
        this.repository = repository;
        this.git = new GitService(repository);
        this.storage = new StorageService(repository, 'codex');
    }
    async save(session) {
        // JSON is authoritative; only commit a phase transition after its report was written.
        const report = new ReportGenerator().generateMarkdown(session)
            .replace('再调用 recheck', '按当前 Skill 新建审查（首版不支持增量复查）');
        await this.storage.write(`${session.id}.md`, report + '\n## Codex 分析来源\n\n'
            + '分析由当前 Codex 会话提供，未调用插件的 DeepSeek API。扫描和核查属于同一会话，不保证判断独立。'
            + '代码引用校验不证明缺陷成立；覆盖清单是模型声明，不是理解完整性的证明。'
            + '本适配器未执行测试，也不采信提交 JSON 中的测试成功声明。'
            + `\n\n适配阶段：${session.codex.phase}。首版支持首次审查，不提供 DSH 增量复查或问题处置。\n`);
        await this.storage.saveSession(session);
    }
    async load(id) {
        const session = await this.storage.loadSession(id);
        if (session.codex?.version !== 1 || !['scan', 'verify', 'done', 'cancelled'].includes(session.codex.phase)) {
            throw new Error('Not a Codex review session; DSH sessions are not interchangeable');
        }
        if (reviewContextHash(session.context) !== session.codex.contextHash)
            throw new Error('Stored business context changed; start a new review');
        return session;
    }
    async freshness(session) {
        const stale = (await this.git.getChanges(session.snapshot.target)).hash !== session.snapshot.hash;
        if (stale) {
            session.stale = true;
            if (session.status !== 'cancelled')
                session.status = 'needs_human';
            session.error = 'Source changed since prepare; start a new review. Old results are not current.';
            await this.save(session);
        }
        return !stale && !session.stale;
    }
    async pending(session, phase) {
        if (!await this.freshness(session))
            throw new Error(session.error);
        if (session.codex.phase !== phase)
            throw new Error(`Expected ${phase} phase, found ${session.codex.phase}`);
    }
    envelope(session) {
        return { sessionId: session.id, codeHash: session.snapshot.hash, contextHash: session.codex.contextHash };
    }
    bind(value, session) {
        const v = object(value);
        for (const [key, expected] of Object.entries(this.envelope(session))) {
            if (v[key] !== expected)
                throw new Error(`Response ${key} does not match frozen input`);
        }
        return v;
    }
    summary(session) {
        return { ...this.envelope(session), phase: session.codex.phase, status: session.status, stale: session.stale,
            reportPath: `${this.storage.directory}/${session.id}.md`, sessionPath: `${this.storage.directory}/${session.id}.json`,
            candidates: session.codex.candidates.length, changedFiles: session.snapshot.files.map(f => f.file),
            batches: this.git.splitLargeChanges(session.snapshot.files).length,
            confirmedIssues: session.rounds.at(-1)?.issues.filter(i => i.status === 'open' && i.verdict === 'confirmed' && !i.optional).length ?? 0,
            needsCheck: session.rounds.at(-1)?.issues.filter(i => i.status === 'open' && i.verdict === 'needs_check').length ?? 0,
            ...riskSummary(session), ...(session.error ? { error: session.error } : {}) };
    }
    async prepare(target, input) {
        const context = contextInput(input);
        return this.storage.withLock(async () => {
            const first = await this.git.getChanges(target);
            const snapshot = await this.git.getChanges(target);
            if (first.hash !== snapshot.hash)
                throw new Error('Source changed while capturing snapshot; retry after edits stop');
            const session = { schemaVersion: 1, id: `RV-${randomUUID()}`, repository: this.repository,
                snapshot, context, rounds: [], calls: [], status: 'in_progress', stale: false, createdAt: Date.now(),
                codex: { version: 1, phase: 'scan', contextHash: reviewContextHash(context), candidates: [], reviewedFiles: [], omissions: [] } };
            await this.save(session);
            return this.summary(session);
        });
    }
    async input(id, batch = 1) {
        return this.storage.withLock(async () => {
            const session = await this.load(id);
            if (!await this.freshness(session))
                throw new Error(session.error);
            if (session.codex.phase === 'scan') {
                const batches = this.git.splitLargeChanges(session.snapshot.files);
                if (!Number.isInteger(batch) || batch < 1 || batch > Math.max(1, batches.length))
                    throw new Error('Invalid batch number');
                return { ...this.envelope(session), phase: 'scan', context: session.context,
                    instruction: INITIAL_SCAN_PROMPT, batch, totalBatches: batches.length, maxCandidates: 20,
                    changes: batches[batch - 1] ?? [], omissions: session.snapshot.omissions,
                    sourceFiles: Object.keys(session.snapshot.sources),
                    responseTemplate: { ...this.envelope(session), reviewedFiles: [], omissions: [], findings: [] } };
            }
            if (session.codex.phase === 'verify')
                return { ...this.envelope(session), phase: 'verify',
                    context: session.context, instruction: VERIFY_FINDING_PROMPT, candidates: session.codex.candidates,
                    responseTemplate: { ...this.envelope(session), verifications: session.codex.candidates.map(f => ({ candidateId: f.id, result: null })) } };
            throw new Error('Review has no pending input');
        });
    }
    async context(id, file, side = 'after', start = 1, end = start + 119) {
        return this.storage.withLock(async () => {
            const session = await this.load(id);
            if (!await this.freshness(session))
                throw new Error(session.error);
            location({ file, lineRange: [start, end], side });
            if (end - start >= 200)
                throw new Error('Read at most 200 lines per context request');
            const source = (side === 'before' ? session.snapshot.before : session.snapshot.sources)[file];
            if (source === undefined)
                throw new Error('File unavailable in frozen snapshot; do not substitute live source');
            const lines = source.split('\n');
            if (start > lines.length)
                throw new Error('Start line is outside frozen file');
            return { ...this.envelope(session), file, side, totalLines: lines.length,
                content: lines.slice(start - 1, end).map((line, i) => `${i + start}: ${line}`).join('\n') };
        });
    }
    async scan(id, value) {
        return this.storage.withLock(async () => {
            const session = await this.load(id);
            await this.pending(session, 'scan');
            const v = this.bind(value, session);
            const reviewed = texts(v.reviewedFiles, 'reviewedFiles');
            const omissions = texts(v.omissions, 'omissions');
            const changed = new Set(session.snapshot.files.map(f => f.file));
            if (reviewed.some(f => !changed.has(f)))
                throw new Error('Reviewed file is outside target changes');
            const candidates = parseFindings(v.findings, 20);
            for (const f of candidates) {
                const source = (f.location.side === 'before' ? session.snapshot.before : session.snapshot.sources)[f.location.file];
                if (!changed.has(f.location.file) || source === undefined || f.location.lineRange[1] > source.split('\n').length) {
                    throw new Error('Candidate location is outside readable target changes');
                }
                if (!reviewed.includes(f.location.file))
                    throw new Error('Candidate file was not declared reviewed');
            }
            session.codex = { ...session.codex, phase: 'verify', candidates, reviewedFiles: reviewed,
                omissions: [...omissions, ...[...changed].filter(f => !reviewed.includes(f)).map(f => `${f}: not reviewed by Codex`)], scan: v };
            await this.save(session);
            return this.summary(session);
        });
    }
    async finish(id, value) {
        return this.storage.withLock(async () => {
            const session = await this.load(id);
            await this.pending(session, 'verify');
            const v = this.bind(value, session);
            if (!Array.isArray(v.verifications))
                throw new Error('verifications must be an array');
            const entries = v.verifications.map(object);
            const ids = entries.map(e => e.candidateId);
            if (new Set(ids).size !== ids.length || ids.length !== session.codex.candidates.length
                || session.codex.candidates.some(f => !ids.includes(f.id)))
                throw new Error('Every candidate requires exactly one verification');
            const issues = session.codex.candidates.map((finding, index) => {
                const entry = entries.find(e => e.candidateId === finding.id);
                const result = object(entry.result);
                // A candidate cannot be quietly relocated to a different file in verification.
                if (result.location && location(result.location).file !== finding.location.file)
                    throw new Error('Verification location must use the candidate file');
                const { issue } = verifyResponse(result, finding, session.snapshot, [], !session.context.requirement.trim() || !session.context.businessRules.length, 1);
                issue.id = `ISS-${String(index + 1).padStart(3, '0')}`;
                return issue;
            });
            const omissions = [...new Set([...session.snapshot.omissions, ...session.codex.omissions])];
            session.rounds = [{ roundNumber: 1, timestamp: Date.now(), codeHash: session.snapshot.hash,
                    contextSnapshot: structuredClone(session.context), contextHash: session.codex.contextHash,
                    snapshot: session.snapshot, issues, newIssuesCount: issues.filter(i => i.status === 'open').length, resolvedIssuesCount: 0,
                    coverage: { files: session.codex.reviewedFiles, omissions,
                        notes: ['当前 Codex 会话完成扫描与核查，不构成独立模型审查。', '覆盖是模型声明，程序不保证代码被完整理解。',
                            '本适配器没有执行测试；核实意见仍可能错误。', ...(!session.context.requirement.trim() || !session.context.businessRules.length ? ['业务依据不完整，业务相关判断需要人工确认。'] : [])] },
                    tests: [], changes: { resolved: [], newIssues: issues.filter(i => i.status === 'open').map(i => i.id), unchanged: [] } }];
            session.codex.verification = v;
            session.codex.phase = 'done';
            session.status = omissions.length ? 'needs_human' : 'completed';
            // Recheck immediately before persisting the final conclusion.
            if (!await this.freshness(session))
                return this.summary(session);
            await this.save(session);
            return this.summary(session);
        });
    }
    async status(id) {
        return this.storage.withLock(async () => {
            const session = await this.load(id);
            await this.freshness(session);
            return this.summary(session);
        });
    }
    async cancel(id, reason) {
        if (!reason.trim() || reason.length > 2000)
            throw new Error('Cancellation reason must be 1..2000 characters');
        return this.storage.withLock(async () => {
            const session = await this.load(id);
            if (session.codex.phase === 'done' || session.codex.phase === 'cancelled')
                throw new Error('Review is already terminal');
            session.codex.phase = 'cancelled';
            session.status = 'cancelled';
            session.error = reason;
            await this.save(session);
            return this.summary(session);
        });
    }
}
