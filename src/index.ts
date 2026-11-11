import type { Context } from '@deepseek-ai/cordis';
import type { ToolRunContext } from '@deepseek-ai/dsh-tools';
import type { ReviewOptions } from './types.js';
import { GitService } from './services/git.js';
import { HarnessModelClient } from './services/harness-model.js';
import { ReviewService } from './services/reviewer.js';
import { startReviewTool } from './tools/start-review.js';
import { recheckTool } from './tools/recheck.js';
import { checkStatusTool } from './tools/check-status.js';
import { dispositionTool } from './tools/disposition.js';

export const name = 'dsh-code-review';
export const inject = ['tools', 'llm'];

export interface Config extends ReviewOptions {
  /** Explicit installer-selected repository. Defaults to the launching directory.
   * When a session supplies its workspace, that workspace precedes the launch fallback.
   */
  cwd?: string;
  /** Omit both to reuse the invoking agent's selected provider and model. */
  provider?: string;
  model?: string;
}

export function apply(ctx: Context, config: Config = {}): void {
  if (!!config.provider !== !!config.model) throw new Error('Configure provider and model together, or omit both');
  const serviceFor = async (exec: ToolRunContext) => {
    const selected = config.provider && config.model ? { provider: config.provider, model: config.model } : exec.agent?.model.current();
    if (!selected) throw new Error('Select a Harness model or configure the plugin provider and model');
    const repository = await new GitService(config.cwd ?? exec.agent?.session?.header.cwd ?? process.cwd(), config).root(exec.signal);
    return new ReviewService(repository, new HarnessModelClient(ctx, selected), config);
  };
  ctx.tools.register(startReviewTool(serviceFor));
  ctx.tools.register(recheckTool(serviceFor));
  ctx.tools.register(checkStatusTool(serviceFor));
  ctx.tools.register(dispositionTool(serviceFor));
  ctx.on('tools/pre-execute', async (exec, next) => {
    const args = exec.arguments as Record<string, unknown>;
    if (exec.name === 'set_review_issue_status') return { kind: 'ask', reason: 'Record a human issue disposition with the supplied reason.' };
    if (exec.name === 'recheck' && args.executeTests === true) return { kind: 'ask', reason: 'Run installer-configured tests; repository test code will execute.' };
    return next();
  });
}
