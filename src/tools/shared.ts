import type { ReviewResult } from '../types.js';

export const reviewOutput = {
  schema: {
    type: 'object', additionalProperties: false,
    properties: {
      sessionId: { type: 'string', required: true },
      status: { type: 'string', required: true },
      reportPath: { type: 'string', required: true },
      confirmedIssues: { type: 'number', required: true },
      needsCheck: { type: 'number', required: true },
      optionalSuggestions: { type: 'number', required: true },
      message: { type: 'string', required: true },
      report: { type: 'string', required: true },
    },
  },
  render: (_args: unknown, value: ReviewResult) => [{ type: 'text' as const, text: value.report }],
} as const;
