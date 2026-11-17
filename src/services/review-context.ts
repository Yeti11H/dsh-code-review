import type { ReviewContext, ReviewSession } from '../types.js';
import { calculateHash } from './git.js';

/** Hash only supported business inputs, independent of object property order. */
export function reviewContextHash(context: ReviewContext): string {
  return calculateHash(JSON.stringify({ requirement: context.requirement,
    businessRules: context.businessRules, outOfScope: context.outOfScope }));
}

export function contextChangedSinceReview(session: ReviewSession): boolean {
  const round = session.rounds.at(-1);
  if (!round || (!round.contextHash && !round.contextSnapshot)) return false;
  const reviewed = round.contextHash ?? reviewContextHash(round.contextSnapshot ?? session.context);
  return reviewed !== reviewContextHash(session.context);
}

/** Only distinct code versions under the current business inputs count. */
export function hasNonconvergingRounds(session: ReviewSession): boolean {
  const currentContext = reviewContextHash(session.context);
  const lastContextChange = session.rounds.findLastIndex(r => (r.contextHash ?? currentContext) !== currentContext);
  const currentRounds = session.rounds.slice(lastContextChange + 1);
  const rounds = currentRounds.filter((r, i, all) => i === 0 || r.codeHash !== all[i - 1]!.codeHash).slice(-3);
  if (rounds.length < 3) return false;
  const open = rounds.map(r => r.issues.filter(i => i.status === 'open' && (!i.optional || i.verdict === 'needs_check')).length);
  return open.at(-1)! > 0 && (rounds.every(r => r.newIssuesCount > 0) || (open[0]! <= open[1]! && open[1]! <= open[2]!));
}
