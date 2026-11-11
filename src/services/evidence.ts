import type { ChangeSnapshot, CodeLocation, Evidence, Finding, VerifiedIssue } from '../types.js';
import { calculateHash } from './git.js';

export function parseJSON(text: string): unknown {
  const body = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  try { return JSON.parse(body); }
  catch { throw new Error('Model returned invalid JSON; review is incomplete'); }
}

export function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Expected JSON object');
  return value as Record<string, unknown>;
}
export function string(value: unknown): string { return typeof value === 'string' ? value : ''; }

export function location(value: unknown): CodeLocation {
  const v = object(value);
  if (typeof v.file !== 'string' || v.file.includes('\0') || v.file.split(/[\\/]/).includes('..') || /^[\\/]|^[A-Za-z]:/.test(v.file)
    || !Array.isArray(v.lineRange) || v.lineRange.length !== 2
    || !v.lineRange.every(n => Number.isInteger(n) && n >= 1) || v.lineRange[1] < v.lineRange[0]
    || (v.side !== undefined && v.side !== 'before' && v.side !== 'after')) throw new Error('Invalid code location in model response');
  return { file: v.file, lineRange: [v.lineRange[0], v.lineRange[1]], side: v.side ?? 'after' };
}

export function parseFindings(raw: unknown, max: number): Finding[] {
  if (!Array.isArray(raw)) throw new Error('First-pass response must be a JSON array');
  if (raw.length > max) throw new Error(`Model exceeded candidate limit (${max}); review incomplete`);
  return raw.map((value, index) => {
    const v = object(value);
    if (!string(v.description).trim() || !string(v.reasoning).trim() || !Array.isArray(v.verification_points)) throw new Error('Incomplete first-pass finding');
    return { id: `FD-${index + 1}`, location: location(v.location), description: string(v.description), reasoning: string(v.reasoning),
      verification_points: v.verification_points.filter((s): s is string => typeof s === 'string'), business_dependent: v.business_dependent === true };
  });
}

export function evidenceMatches(e: Evidence, snapshot: ChangeSnapshot): boolean {
  const text = (e.side === 'before' ? snapshot.before : snapshot.sources)[e.file];
  if (text === undefined || !e.quote.trim()) return false;
  const lines = text.split('\n');
  if (e.lineRange[1] > lines.length) return false;
  return lines.slice(e.lineRange[0] - 1, e.lineRange[1]).join('\n').replace(/\r\n/g, '\n') === e.quote.replace(/\r\n/g, '\n');
}

export function verifyResponse(raw: unknown, finding: Finding, snapshot: ChangeSnapshot,
  contextFiles: string[], missingBusiness: boolean, round: number,
): { issue: VerifiedIssue; resolved: boolean } {
  const v = object(raw);
  if (!['confirmed', 'false_positive', 'needs_check'].includes(string(v.verdict))) throw new Error('Invalid verification verdict');
  if (!['correctness', 'performance', 'security', 'maintainability'].includes(string(v.category))) throw new Error('Invalid issue category');
  const loc = v.location ? location(v.location) : finding.location;
  const evidence = Array.isArray(v.code_evidence) ? v.code_evidence.map(e => ({ ...location(e), quote: string(object(e).quote) })) : [];
  const validEvidence = evidence.filter(e => evidenceMatches(e, snapshot));
  const reasons: string[] = [];
  const businessDependent = v.business_dependent === true || finding.business_dependent;
  if (evidence.length !== validEvidence.length || !validEvidence.length) reasons.push('代码引用缺失或与快照行号、原文不匹配');
  const source = (loc.side === 'before' ? snapshot.before : snapshot.sources)[loc.file];
  if (source === undefined || loc.lineRange[1] > source.split('\n').length) reasons.push('问题位置不在可读取快照中');
  if (!string(v.rationale).trim()) reasons.push('缺少核查结论依据');
  if (v.verdict === 'confirmed' && (![v.trigger_condition, v.error_process, v.actual_impact].every(x => string(x).trim()))) reasons.push('触发路径或影响不完整');
  if (businessDependent && missingBusiness) reasons.push('业务预期尚未确认');
  const verdict = reasons.length ? 'needs_check' : v.verdict as VerifiedIssue['verdict'];
  const resolved = v.resolved === true && verdict === 'false_positive' && validEvidence.some(e => e.side !== 'before');
  const fingerprint = calculateHash(JSON.stringify([loc.file, finding.description.replace(/\s+/g, '').toLowerCase()]));
  return { resolved, issue: {
    id: '', fingerprint, title: string(v.title) || finding.description, status: verdict === 'false_positive' ? 'resolved' : 'open',
    verdict, location: loc, trigger_condition: string(v.trigger_condition), error_process: string(v.error_process),
    actual_impact: string(v.actual_impact), code_evidence: validEvidence,
    verification_status: verdict === 'needs_check' ? 'needs_manual_check' : 'code_analysis_only',
    verification_method: string(v.verification_method), suggested_fix: string(v.suggested_fix),
    category: v.category as VerifiedIssue['category'], priority: ['high', 'medium', 'low'].includes(string(v.priority)) ? v.priority as VerifiedIssue['priority'] : 'medium',
    optional: v.optional === true, origin: ['introduced', 'pre_existing', 'unknown'].includes(string(v.origin)) ? v.origin as VerifiedIssue['origin'] : 'unknown',
    rationale: [string(v.rationale), ...reasons].filter(Boolean).join('；'), dependencies: [...new Set([...contextFiles, loc.file, ...validEvidence.map(e => e.file)])],
    business_dependent: businessDependent, firstSeenRound: round, lastSeenRound: round,
  } };
}
