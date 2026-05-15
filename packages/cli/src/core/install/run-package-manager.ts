import { spawn } from 'node:child_process';

export function runPackageManager(command: string, args: readonly string[], cwd: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, [...args], { cwd, stdio: 'inherit', shell: process.platform === 'win32' });
    child.on('exit', (code) => resolve(code ?? 0));
    child.on('error', (err) => reject(err));
  });
}
