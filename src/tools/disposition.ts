import { defineTool } from '@deepseek-ai/dsh-tools';
import type { ServiceFor } from './start-review.js';
import { reviewOutput } from './shared.js';

export function dispositionTool(serviceFor: ServiceFor) {
  return defineTool({
    name: 'set_review_issue_status',
    description: 'Record an explicit human decision to accept a risk or reopen an issue. Requires a reason and Harness approval. Never use this to silently clear findings.',
    parameters: {
      sessionId: { type: 'string', required: true },
      issueId: { type: 'string', required: true },
      action: { type: 'string', required: true },
      reason: { type: 'string', required: true },
    },
    output: reviewOutput,
    async execute(args, exec) {
      if (args.action !== 'wont_fix' && args.action !== 'reopen') throw new Error('action must be wont_fix or reopen');
      return (await serviceFor(exec)).disposition(args.sessionId, args.issueId, args.action, args.reason);
    },
  });
}
