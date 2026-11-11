import { defineTool } from '@deepseek-ai/dsh-tools';
import type { ServiceFor } from './start-review.js';
import { reviewOutput } from './shared.js';

export function checkStatusTool(serviceFor: ServiceFor) {
  return defineTool({
    name: 'check_review_status',
    description: 'List local code reviews or inspect a review with a fresh source-staleness check.',
    parameters: { sessionId: { type: 'string' } },
    output: reviewOutput,
    async execute(args, exec) {
      const result = await (await serviceFor(exec)).checkStatus(args.sessionId, exec.signal);
      if (!Array.isArray(result)) return result;
      return { sessionId: '', status: 'list', reportPath: '', confirmedIssues: 0, needsCheck: 0, optionalSuggestions: 0, overallRiskScore: 0, recommendation: 'no_findings',
        message: `${result.length} reviews`, report: JSON.stringify(result, null, 2) };
    },
  });
}
