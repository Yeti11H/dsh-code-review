import type { Context } from '@deepseek-ai/cordis';
import type {} from '@deepseek-ai/dsh-llm';
import type { ModelClient, ModelRequest } from '../types.js';

declare module '@deepseek-ai/dsh-llm/types' {
  interface LlmRequestPurposeMap { 'code-review': true }
}

export class HarnessModelClient implements ModelClient {
  constructor(private readonly ctx: Context, private readonly route: { provider: string; model: string }) {}

  async complete(request: ModelRequest, signal?: AbortSignal): Promise<string> {
    let text = ''; let finished = false;
    for await (const chunk of this.ctx.llm.stream({ ...this.route, purpose: 'code-review',
      system: request.system, messages: [{ role: 'user', content: [{ type: 'text', text: request.prompt }] }],
      temperature: request.phase === 'scan' ? 0.3 : 0.1, maxTokens: 8000, tools: [], signal })) {
      signal?.throwIfAborted();
      if (chunk.type === 'text-delta') text += chunk.text;
      if (text.length > 1_000_000) throw new Error('Model response exceeds 1 MB');
      if (chunk.type === 'finish') {
        finished = true;
        if (chunk.reason.kind !== 'stop') throw new Error(`Model did not complete: ${JSON.stringify(chunk.reason)}`);
      }
    }
    if (!finished) throw new Error('Model stream ended without a finish result');
    return text;
  }
}
