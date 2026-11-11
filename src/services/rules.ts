import { Worker } from 'node:worker_threads';
import type { ChangeSnapshot, CustomRule, FileChange, RuleMatch } from '../types.js';

export function validateRules(rules: CustomRule[] = []): void {
  if (!Array.isArray(rules) || rules.length > 30) throw new Error('customRules must contain at most 30 rules');
  const names = new Set<string>();
  for (const rule of rules) {
    if (!rule || typeof rule.name !== 'string' || !rule.name.trim() || rule.name.length > 100 || names.has(rule.name)
      || typeof rule.pattern !== 'string' || !rule.pattern || rule.pattern.length > 256
      || typeof rule.message !== 'string' || rule.message.length > 1000
      || !['critical', 'high', 'medium', 'low'].includes(rule.severity)
      || !['security', 'correctness', 'performance', 'maintainability'].includes(rule.category)) throw new Error('Invalid custom rule');
    names.add(rule.name);
    try { new RegExp(rule.pattern); } catch { throw new Error(`Invalid regex in custom rule: ${rule.name}`); }
  }
}

/** Only added after-lines; regex results are hints, never confirmed defects. */
export async function scanRules(snapshot: ChangeSnapshot, files: FileChange[], rules: CustomRule[] = [], signal?: AbortSignal): Promise<{ matches: RuleMatch[]; notes: string[] }> {
  if (!rules.length) return { matches: [], notes: [] };
  const lines: Array<{ file: string; line: number; text: string }> = [];
  const seen = new Set<string>();
  const notes: string[] = [];
  let bytes = 0;
  outer: for (const file of files) {
    let current = 0, inHunk = false;
    for (const text of file.diff.split('\n')) {
      const hunk = /^@@ -\d+(?:,\d+)? \+(\d+)/.exec(text);
      if (hunk) { current = Number(hunk[1]); inHunk = true; continue; }
      if (!inHunk || text.startsWith('\\')) continue;
      if (text.startsWith('+')) {
        const source = snapshot.sources[file.file]?.split('\n')[current - 1];
        const key = `${file.file}:${current}`;
        if (source !== undefined && !seen.has(key)) {
          bytes += source.length;
          if (bytes > 1_000_000 || source.length > 20_000 || lines.length >= 20_000) { notes.push('自定义规则扫描预算不足，部分新增行未检查'); break outer; }
          lines.push({ file: file.file, line: current, text: source }); seen.add(key);
        }
        current++;
      } else if (text.startsWith(' ')) current++;
    }
  }
  signal?.throwIfAborted();
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./rules-worker.js', import.meta.url), { workerData: { rules, lines } });
    let settled = false;
    const cleanup = () => { settled = true; clearTimeout(timer); signal?.removeEventListener('abort', abort); void worker.terminate(); };
    const abort = () => { cleanup(); reject(signal?.reason); };
    const timer = setTimeout(() => { cleanup(); resolve({ matches: [], notes: [...notes, '自定义规则匹配超时，未完成检查'] }); }, 1500);
    signal?.addEventListener('abort', abort, { once: true });
    worker.once('message', (result: { matches: RuleMatch[]; truncated: boolean }) => {
      if (settled) return; cleanup();
      resolve({ matches: result.matches, notes: [...notes, ...(result.truncated ? ['自定义规则命中超过 100 条，已截断'] : [])] });
    });
    worker.once('error', error => { if (!settled) { cleanup(); reject(error); } });
    worker.once('exit', code => { if (!settled) { cleanup(); reject(new Error(`Rule worker exited early: ${code}`)); } });
  });
}
