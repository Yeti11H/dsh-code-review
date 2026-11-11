import { defineTool } from '@deepseek-ai/dsh-tools';
import type { ServiceFor } from './start-review.js';
import { reviewOutput } from './shared.js';

export function recheckTool(serviceFor: ServiceFor) {
  return defineTool({
    name: 'recheck',
    description: 'Recheck an existing review after fixes. Tracks stable issue IDs and new changes. executeTests runs only installer-configured commands, only when explicitly requested by the user.',
    parameters: {
      sessionId: { type: 'string', required: true },
      executeTests: { type: 'boolean', description: 'Default false. Requires user request and installer-configured test commands. Tests may execute repository code.' },
    },
    output: reviewOutput,
    async execute(args, exec) { return (await serviceFor(exec)).recheck(args.sessionId, args.executeTests ?? false, exec.signal); },
  });
}
