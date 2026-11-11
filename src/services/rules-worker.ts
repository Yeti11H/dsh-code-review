import { parentPort, workerData } from 'node:worker_threads';
import type { CustomRule, RuleMatch } from '../types.js';

const { rules, lines } = workerData as { rules: CustomRule[]; lines: Array<{ file: string; line: number; text: string }> };
const matches: RuleMatch[] = [];
let truncated = false;
outer: for (const rule of rules) {
  const pattern = new RegExp(rule.pattern);
  for (const line of lines) {
    if (!pattern.test(line.text)) continue;
    if (matches.length >= 100) { truncated = true; break outer; }
    matches.push({ name: rule.name, severity: rule.severity, category: rule.category, message: rule.message,
      file: line.file, lineRange: [line.line, line.line], side: 'after', quote: line.text });
  }
}
parentPort!.postMessage({ matches, truncated });
