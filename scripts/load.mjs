import { writeFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const plugin = fileURLToPath(new URL('../dist/index.js', import.meta.url));
const repository = await realpath(process.argv[2] ?? process.cwd());
const output = path.resolve(process.argv[3] ?? 'local-overlay.yml');
const quote = value => JSON.stringify(value.replaceAll('\\', '/'));
await writeFile(output, `- insert:\n    - id: evidence-code-review\n      name: ${quote(plugin)}\n      config:\n        cwd: ${quote(repository)}\n`, 'utf8');
process.stdout.write(`Overlay: ${output}\nLoad: npx @deepseek-ai/dsh@0.2.2-rc.1 web --patch "${output}"\n`);
