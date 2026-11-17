import { parseArgs } from 'node:util';
import { lstat, readFile } from 'node:fs/promises';
import path from 'node:path';
import { GitService } from '../services/git.js';
import { CodexReview } from './review.js';

const HELP = `Offline Codex review (Node >=24.9, Git; no API key)
prepare --cwd <repo> --target <working|branch|commit> --context <context.json>
input   --cwd <repo> --session <id> [--batch <n>]
context --cwd <repo> --session <id> --file <relative> [--side before|after] [--start <n>] [--end <n>]
scan    --cwd <repo> --session <id> --response <scan.json>
finish  --cwd <repo> --session <id> --response <verification.json>
status  --cwd <repo> --session <id>
cancel  --cwd <repo> --session <id> --reason <text>
Exit: 0 command accepted (not approval), 2 invalid/incomplete/stale/cancelled. Read phase/status.`;

async function jsonFile(file: string | undefined): Promise<unknown> {
  if (!file) throw new Error('JSON file path is required');
  const full = path.resolve(file);
  const stat = await lstat(full);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 2_000_000) throw new Error('Input must be a regular JSON file <= 2 MB');
  return JSON.parse((await readFile(full, 'utf8')).replace(/^\uFEFF/, ''));
}

export async function main(args = process.argv.slice(2)): Promise<number> {
  try {
    const { values, positionals } = parseArgs({ args, allowPositionals: true, options: {
      cwd: { type: 'string' }, target: { type: 'string' }, context: { type: 'string' }, session: { type: 'string' },
      response: { type: 'string' }, batch: { type: 'string' }, file: { type: 'string' }, side: { type: 'string' },
      start: { type: 'string' }, end: { type: 'string' }, reason: { type: 'string' }, help: { type: 'boolean' },
    } });
    if (values.help) { console.log(HELP); return 0; }
    const command = positionals[0] ?? '';
    const flags: Record<string, string[]> = {
      prepare: ['target', 'context'], input: ['session', 'batch'], context: ['session', 'file', 'side', 'start', 'end'],
      scan: ['session', 'response'], finish: ['session', 'response'], status: ['session'], cancel: ['session', 'reason'],
    };
    if (!Object.hasOwn(flags, command) || positionals.length !== 1) throw new Error(HELP);
    for (const key of Object.keys(values)) if (key !== 'cwd' && !flags[command]!.includes(key)) throw new Error(`--${key} is not supported for ${command}`);
    if (command !== 'prepare' && !values.session) throw new Error('--session is required');
    const repository = await new GitService(path.resolve(values.cwd ?? '.')).root();
    const adapter = new CodexReview(repository);
    let result: unknown;
    switch (command) {
      case 'prepare': result = await adapter.prepare(values.target ?? 'working', await jsonFile(values.context)); break;
      case 'input': result = await adapter.input(values.session!, Number(values.batch ?? 1)); break;
      case 'context':
        if (!values.file) throw new Error('--file is required');
        result = await adapter.context(values.session!, values.file, values.side ?? 'after',
          Number(values.start ?? 1), values.end === undefined ? undefined : Number(values.end)); break;
      case 'scan': result = await adapter.scan(values.session!, await jsonFile(values.response)); break;
      case 'finish': result = await adapter.finish(values.session!, await jsonFile(values.response)); break;
      case 'status': result = await adapter.status(values.session!); break;
      case 'cancel': result = await adapter.cancel(values.session!, values.reason ?? ''); break;
    }
    console.log(JSON.stringify(result, null, 2));
    const state = result as { stale?: boolean; status?: string };
    return state.stale || ['needs_human', 'failed', 'cancelled'].includes(state.status ?? '') ? 2 : 0;
  } catch (error) {
    console.error(JSON.stringify({ error: error instanceof Error ? error.message : String(error), completed: false }));
    return 2;
  }
}
