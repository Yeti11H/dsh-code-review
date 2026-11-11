import { defineTool } from '@deepseek-ai/dsh-tools';
import type { ToolRunContext } from '@deepseek-ai/dsh-tools';
import type { ReviewService } from '../services/reviewer.js';
import { reviewOutput } from './shared.js';

export type ServiceFor = (exec: ToolRunContext) => Promise<ReviewService>;

export function startReviewTool(serviceFor: ServiceFor) {
  return defineTool({
    name: 'start_review',
    description: 'Start evidence-based, two-pass code review. Reads frozen Git sources, writes only .dsh-review reports. Does not approve merges or edit source.',
    parameters: {
      target: { type: 'string', description: 'unstaged = all uncommitted changes including staged and nonignored untracked files; a branch name compares merge-base to committed HEAD.' },
      requirement: { type: 'string', description: 'User-confirmed requirement; leave blank when unknown.' },
      businessRules: { type: 'array', items: { type: 'string' }, description: 'User-confirmed business rules, not model inventions.' },
      outOfScope: { type: 'array', items: { type: 'string' }, description: 'Explicitly excluded business changes.' },
    },
    output: reviewOutput,
    async execute(args, exec) {
      const service = await serviceFor(exec);
      return service.startReview(args.target ?? 'unstaged', { requirement: args.requirement ?? '',
        businessRules: args.businessRules ?? [], outOfScope: args.outOfScope ?? [] }, exec.signal);
    },
  });
}
