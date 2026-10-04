import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export function hasBinary(name: string): boolean {
  return spawnSync('sh', ['-c', `command -v ${name}`], { stdio: 'ignore' }).status === 0;
}

/** Writes bytes to a temporary file, runs a command on it and returns stdout. */
export function runOn(
  bytes: Uint8Array,
  filename: string,
  command: string,
  args: (path: string, dir: string) => string[],
): string {
  const dir = mkdtempSync(join(tmpdir(), 'vc-test-'));
  try {
    const path = join(dir, filename);
    writeFileSync(path, bytes);
    return execFileSync(command, args(path, dir), {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 60_000,
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
