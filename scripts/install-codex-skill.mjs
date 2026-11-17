import { cp, lstat, mkdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { parseArgs } from 'node:util';

const { values } = parseArgs({ options: { destination: { type: 'string' } } });
const source = fileURLToPath(new URL('../skills/dsh-code-review/', import.meta.url));
const parent = path.resolve(values.destination ?? path.join(process.env.CODEX_HOME || path.join(homedir(), '.codex'), 'skills'));
const target = path.join(parent, 'dsh-code-review');
await lstat(path.join(source, 'runtime', 'codex', 'cli.js')); // Fail before making an incomplete installation.
try { await lstat(target); throw new Error(`Destination already exists; inspect before replacing: ${target}`); }
catch (error) { if (error.code !== 'ENOENT') throw error; }
await mkdir(parent, { recursive: true });
await cp(source, target, { recursive: true, errorOnExist: true, force: false });
console.log(JSON.stringify({ installed: target, invocation: '$dsh-code-review', note: 'Open a new Codex conversation to discover the skill.' }));
