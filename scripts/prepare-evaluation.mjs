import { mkdir, readFile, writeFile, stat } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const output = path.resolve(process.argv[2] ?? 'work/evaluation');
const source = fileURLToPath(new URL('../examples/test-cases/', import.meta.url));
const cases = [
  ['race', 'case-1-race-condition/before.ts'],
  ['clean', 'case-2-false-positive/code.ts'],
  ['missing-context', 'case-3-missing-context/code.ts'],
];
for (const [name, relative] of cases) {
  const directory = path.join(output, name);
  try { await stat(directory); throw new Error(`Refusing to overwrite existing evaluation directory: ${directory}`); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  await mkdir(directory, { recursive: true });
  const git = (...args) => execFileSync('git', args, { cwd: directory, encoding: 'utf8', windowsHide: true });
  git('init', '-q', '-b', 'main'); git('config', 'user.name', 'Local evaluation'); git('config', 'user.email', 'evaluation@example.invalid');
  await writeFile(path.join(directory, 'index.ts'), '// Evaluation baseline\n');
  git('add', '.'); git('commit', '-qm', 'evaluation baseline');
  await writeFile(path.join(directory, 'index.ts'), await readFile(path.join(source, relative), 'utf8'));
  process.stdout.write(`${name}: ${directory}\n`);
}
