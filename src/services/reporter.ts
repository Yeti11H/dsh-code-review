import type { ReviewSession, VerifiedIssue } from '../types.js';
import { calculateRiskScore, riskSummary } from './risk.js';

const clean = (s: string) => s.replace(/[<>]/g, c => c === '<' ? '&lt;' : '&gt;');
const fence = (s: string) => { const n = Math.max(3, ...[...s.matchAll(/`+/g)].map(m => m[0].length + 1)); return '`'.repeat(n); };

export class ReportGenerator {
  generateJSON(session: ReviewSession): string { return JSON.stringify({ ...session, ...riskSummary(session) }, null, 2); }

  generateMarkdown(session: ReviewSession): string {
    const round = session.rounds.at(-1);
    const open = round?.issues.filter(i => i.status === 'open') ?? [];
    const confirmed = open.filter(i => i.verdict === 'confirmed' && !i.optional);
    const needsCheck = open.filter(i => i.verdict === 'needs_check');
    const optional = open.filter(i => i.optional && i.verdict !== 'needs_check');
    const falsePositives = round?.issues.filter(i => i.verdict === 'false_positive') ?? [];
    const accepted = round?.issues.filter(i => i.status === 'wont_fix') ?? [];
    const risk = riskSummary(session);
    const sections = [`# 代码审查报告`, `会话：${session.id}  \n状态：${session.status}  \n轮次：${round?.roundNumber ?? 0}  \n快照：${round?.codeHash ?? session.snapshot.hash}  \n时间：${new Date(round?.timestamp ?? session.createdAt).toISOString()}`,
      `> 本报告是审查结果，不是合并批准。没有发现问题不代表没有缺陷。${session.stale ? ' 代码已变化，当前报告已过期。' : ''}`,
      `## 风险处理优先级：${risk.overallRiskScore}/10\n\n建议：${risk.recommendation}。高优先级 ${risk.high} 项；中 ${risk.medium} 项；低 ${risk.low} 项。\n\n分数是类别、严重性与核查状态的启发式排序，不是缺陷概率；总分取未处理问题最高值。0 分也不能批准合并。`,
      ...(session.error ? [`## 未完成原因\n\n${clean(session.error)}`] : []),
      `## 审查范围\n\n需求：${clean(session.context.requirement || '未提供，业务行为未确认')}\n\n业务规则：\n${session.context.businessRules.map(r => '- ' + clean(r)).join('\n') || '- 未提供'}\n\n不涉及范围：\n${session.context.outOfScope.map(r => '- ' + clean(r)).join('\n') || '- 未提供'}\n\n目标：${clean(session.snapshot.target)}`,
      `## 已确认问题（${confirmed.length}）\n\n${confirmed.map(i => this.renderIssue(i)).join('\n\n') || '本轮未发现有证据支持的非可选缺陷。'}`,
      `## 待核查风险（${needsCheck.length}）\n\n${needsCheck.map(i => this.renderIssue(i)).join('\n\n') || '无。'}`,
      `## 可选建议（${optional.length}）\n\n${optional.map(i => this.renderIssue(i)).join('\n\n') || '无。'}`,
      `## 误报反证与已解决问题\n\n${falsePositives.map(i => this.renderIssue(i)).join('\n\n') || '无。'}`,
      `## 已记录接受的风险（${accepted.length}）\n\n${accepted.map(i => this.renderIssue(i)).join('\n\n') || '无。'}`,
      `## 自定义规则命中（${round?.ruleMatches?.length ?? 0}）\n\n命中仅表示文本匹配，需要结合语义核查，不自动证明缺陷。\n\n${round?.ruleMatches?.map(m => `- ${clean(m.name)}：${clean(m.file)}:${m.lineRange[0]}（${m.severity}） ${clean(m.message)}`).join('\n') || '无。'}`,
      `## 检查覆盖与限制\n\n本轮新增扫描文件：\n${round?.coverage.files.map(f => '- ' + clean(f)).join('\n') || '- 无；可能只执行了原问题复核或测试'}\n\n未覆盖内容：\n${(round?.coverage.omissions ?? session.snapshot.omissions).map(s => '- ' + clean(s)).join('\n') || '- 未因文件读取限制排除内容；模型分析仍可能遗漏问题。'}\n\n${round?.coverage.notes.map(s => '- ' + clean(s)).join('\n') || ''}`,
      `## 测试执行记录\n\n${round?.tests.length ? round.tests.map(t => `- ${clean(JSON.stringify([t.file, ...t.args]))}：退出码 ${t.exitCode}；快照 ${t.codeHash}\n\n${fence(t.stdout + t.stderr)}text\n${clean(t.stdout + t.stderr)}\n${fence(t.stdout + t.stderr)}`).join('\n\n') : '本轮没有执行测试。代码分析不等于运行验证。'}`,
      `## 审查历史\n\n| 轮次 | 新问题 | 已解决 | 未处理 |\n|---|---:|---:|---:|\n${session.rounds.map(r => `| ${r.roundNumber} | ${r.newIssuesCount} | ${r.resolvedIssuesCount} | ${r.issues.filter(i => i.status === 'open').length} |`).join('\n')}`,
      `## 下一步\n\n${this.getNextSteps(session)}`];
    return sections.join('\n\n') + '\n';
  }

  renderIssue(issue: VerifiedIssue): string {
    return `### ${issue.id}：${clean(issue.title)}\n\n位置：${clean(issue.location.file)}:${issue.location.lineRange.join('-')}（${issue.location.side ?? 'after'}）  \n状态：${issue.status}；严重性：${issue.priority}；来源：${issue.origin}；处理优先级：${calculateRiskScore(issue)}/10\n\n触发条件：${clean(issue.trigger_condition)}\n\n执行过程：${clean(issue.error_process)}\n\n实际影响：${clean(issue.actual_impact)}\n\n核查依据：${clean(issue.rationale)}\n\n${issue.code_evidence.map(e => `${clean(e.file)}:${e.lineRange.join('-')}（${e.side ?? 'after'}）\n\n${fence(e.quote)}text\n${clean(e.quote)}\n${fence(e.quote)}`).join('\n\n') || '尚无可核对的代码引用。'}\n\n验证状态：${issue.verification_status}  \n验证方法：${clean(issue.verification_method)}\n\n建议修复：${clean(issue.suggested_fix)}`;
  }

  getNextSteps(session: ReviewSession): string {
    if (session.status === 'failed' || session.status === 'cancelled' || session.status === 'in_progress') return '本次审查未完成，不能据此判断改动已通过检查。处理错误或取消原因后重新审查。';
    if (session.stale) return '代码已变化，请复查新快照。';
    if (session.status === 'needs_human') return '需要人工介入：检查需求、设计、未覆盖范围或连续不收敛的问题。轮次上限不代表自动放行。';
    const open = session.rounds.at(-1)?.issues.filter(i => i.status === 'open') ?? [];
    return open.length ? `处理 ${open.length} 个待解决或待核查问题，再调用 recheck。可选建议由负责人取舍。`
      : '本轮未发现待处理问题。请负责人确认未验证范围、必要测试和发布恢复方案，再决定是否合并。';
  }
}

