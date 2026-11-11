import type { ReviewSession, RiskSummary, VerifiedIssue } from '../types.js';

export function calculateRiskScore(issue: VerifiedIssue): number {
  if (issue.status !== 'open' || issue.verdict === 'false_positive') return 0;
  let score = { security: 6, correctness: 5, performance: 4, maintainability: 2 }[issue.category];
  score += { high: 2, medium: 1, low: 0 }[issue.priority];
  if (issue.verdict === 'confirmed') score += 2;
  if (issue.optional) score = Math.min(score, 4);
  return Math.max(1, Math.min(10, score));
}

export function riskSummary(session: ReviewSession): RiskSummary {
  const open = session.rounds.at(-1)?.issues.filter(i => i.status === 'open') ?? [];
  const scores = open.map(calculateRiskScore);
  const uncertain = session.status !== 'completed' || session.stale || open.some(i => i.verdict === 'needs_check');
  return { overallRiskScore: Math.max(0, ...scores),
    recommendation: uncertain ? 'needs_human_review' : open.some(i => i.verdict === 'confirmed' && !i.optional) ? 'request_changes' : 'no_findings',
    high: scores.filter(s => s >= 8).length, medium: scores.filter(s => s >= 5 && s < 8).length, low: scores.filter(s => s < 5).length };
}
