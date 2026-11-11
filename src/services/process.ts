import { execFile } from 'node:child_process';

export async function runProcess(file: string, args: string[], cwd: string,
  signal?: AbortSignal, timeout = 30_000, maxBuffer = 32 * 1024 * 1024,
): Promise<{ stdout: string; stderr: string; exitCode: number | null }> {
  signal?.throwIfAborted();
  return new Promise((resolve, reject) => {
    execFile(file, args, { cwd, signal, timeout, maxBuffer, encoding: 'utf8',
      windowsHide: true, env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_PAGER: 'cat' } },
    (error, stdout, stderr) => {
      if (signal?.aborted) { reject(signal.reason); return; }
      if (error && (error.killed || typeof error.code !== 'number')) { reject(error); return; }
      resolve({ stdout, stderr, exitCode: error ? Number(error.code) : 0 });
    });
  });
}
