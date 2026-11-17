import { copyFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const runtime = path.join(root, 'skills', 'dsh-code-review', 'runtime');
// Only offline dependencies; never ship a model client, DSH loader or node_modules.
const modules = ['codex/cli.js', 'codex/review.js', 'services/git.js', 'services/process.js', 'services/storage.js',
  'services/evidence.js', 'services/reporter.js', 'services/risk.js', 'services/review-context.js',
  'prompts/initial-scan.js', 'prompts/verify-findings.js'];
for (const module of modules) {
  const destination = path.join(runtime, module);
  await mkdir(path.dirname(destination), { recursive: true });
  await copyFile(path.join(root, 'dist', module), destination);
}
await copyFile(path.join(root, 'LICENSE'), path.join(root, 'skills', 'dsh-code-review', 'LICENSE'));
console.log('Built self-contained skills/dsh-code-review');
