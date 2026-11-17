import { defineTool } from '@deepseek-ai/dsh-tools';
import type { ServiceFor } from './start-review.js';
import { reviewOutput } from './shared.js';

export function recheckTool(serviceFor: ServiceFor) {
  return defineTool({
    name: 'recheck',
    description: 'Recheck an existing review after fixes or user-confirmed business rule changes. reviewContext replaces all business inputs; never invent rules. Tracks stable issue IDs. executeTests runs only installer-configured commands, only when explicitly requested by the user.',
    parameters: {
      sessionId: { type: 'string', required: true },
      executeTests: { type: 'boolean', description: 'Default false. Requires user request and installer-configured test commands. Tests may execute repository code.' },
      reviewContext: { type: 'object', additionalProperties: false, description: 'Optional complete replacement of user-confirmed business inputs; omit to retain existing rules.', properties: {
        requirement: { type: 'string', required: true },
        businessRules: { type: 'array', items: { type: 'string' }, required: true },
        outOfScope: { type: 'array', items: { type: 'string' }, required: true },
      } },
    },
    output: reviewOutput,
    async execute(args, exec) { return (await serviceFor(exec)).recheck(args.sessionId, args.executeTests ?? false, exec.signal, args.reviewContext); },
  });
}
