import type { ModelClient, ModelRequest } from '../types.js';

/** Noninteractive transport for CI. No request/response headers or credentials are persisted. */
export class DeepSeekModelClient implements ModelClient {
  readonly usage: unknown[] = [];
  constructor(private readonly apiKey: string, private readonly model = 'deepseek-chat', private readonly baseUrl = 'https://api.deepseek.com', private readonly maxTokens = 3000) {
    const url = new URL(baseUrl);
    if (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))) throw new Error('Model endpoint must use HTTPS, except loopback test servers');
    if (!apiKey || !Number.isInteger(maxTokens) || maxTokens < 1 || maxTokens > 8000) throw new Error('Invalid model credentials or token limit');
  }

  async complete(request: ModelRequest, signal?: AbortSignal): Promise<string> {
    const response = await fetch(this.baseUrl.replace(/\/$/, '') + '/chat/completions', {
      method: 'POST', signal, headers: { Authorization: `Bearer ${this.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: this.model, messages: [{ role: 'system', content: request.system }, { role: 'user', content: request.prompt }],
        temperature: request.phase === 'scan' ? 0.3 : 0.1, max_tokens: this.maxTokens, stream: false }),
    });
    if (!response.ok) throw new Error(`Model HTTP ${response.status}; review incomplete`);
    const body = await response.text();
    if (body.length > 1_000_000) throw new Error('Model response exceeds 1 MB');
    const data = JSON.parse(body);
    this.usage.push({ requestedModel: this.model, returnedModel: data.model, usage: data.usage });
    if (data.choices?.[0]?.finish_reason !== 'stop' || typeof data.choices[0].message?.content !== 'string') throw new Error('Model did not finish normally');
    return data.choices[0].message.content;
  }
}
