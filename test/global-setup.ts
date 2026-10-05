/**
 * Vitest global setup.
 *
 * Provides `databaseUrl` to tests that need PostgreSQL:
 *   1. `TEST_DATABASE_URL` when set (CI uses a service container);
 *   2. otherwise a throwaway cluster started from a local PostgreSQL installation
 *      (`initdb`/`pg_ctl`), removed on teardown;
 *   3. otherwise `null`, and database tests are skipped.
 *
 * Set `VANILLATE_TEST_POSTGRES=0` to skip starting a local cluster.
 */
import { execFileSync } from 'node:child_process';
import { chownSync, existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir, userInfo } from 'node:os';
import { join } from 'node:path';

import type { TestProject } from 'vitest/node';

function findPgBin(): string | null {
  const base = '/usr/lib/postgresql';
  if (!existsSync(base)) return null;
  const versions = readdirSync(base).sort((a, b) => Number(b) - Number(a));
  for (const version of versions) {
    const bin = join(base, version, 'bin');
    if (existsSync(join(bin, 'initdb')) && existsSync(join(bin, 'pg_ctl'))) return bin;
  }
  return null;
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.unref();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      server.close(() => {
        if (address && typeof address === 'object') resolve(address.port);
        else reject(new Error('could not allocate a port'));
      });
    });
  });
}

export default async function setup(project: TestProject): Promise<(() => void) | undefined> {
  const fromEnv = process.env.TEST_DATABASE_URL;
  if (fromEnv) {
    project.provide('databaseUrl', fromEnv);
    return undefined;
  }
  const bin = findPgBin();
  if (process.env.VANILLATE_TEST_POSTGRES === '0' || !bin) {
    project.provide('databaseUrl', null);
    return undefined;
  }

  const asRoot = userInfo().uid === 0;
  // PostgreSQL refuses to run as root; use the `postgres` system user in that case.
  const run = (cmd: string, args: string[]): void => {
    const command = asRoot ? 'runuser' : join(bin, cmd);
    const argv = asRoot ? ['-u', 'postgres', '--', join(bin, cmd), ...args] : args;
    execFileSync(command, argv, { stdio: 'pipe' });
  };

  const dir = mkdtempSync(join(tmpdir(), 'vanillate-pg-'));
  const data = join(dir, 'data');
  const socketDir = dir;
  try {
    if (asRoot) {
      const pwd = execFileSync('id', ['-u', 'postgres']).toString().trim();
      const gid = execFileSync('id', ['-g', 'postgres']).toString().trim();
      chownSync(dir, Number(pwd), Number(gid));
    }
    const port = await freePort();
    run('initdb', ['-D', data, '-U', 'vanillate', '--auth=trust', '--no-sync', '-E', 'UTF8']);
    run('pg_ctl', [
      '-D',
      data,
      '-l',
      join(dir, 'postgres.log'),
      '-o',
      `-p ${port} -k ${socketDir} -c listen_addresses=127.0.0.1 -c fsync=off -c full_page_writes=off`,
      '-w',
      'start',
    ]);
    project.provide('databaseUrl', `postgres://vanillate@127.0.0.1:${port}/postgres`);
    return () => {
      try {
        run('pg_ctl', ['-D', data, '-m', 'immediate', '-w', 'stop']);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    };
  } catch (error) {
    console.warn(`[test] could not start a local PostgreSQL cluster: ${(error as Error).message}`);
    rmSync(dir, { recursive: true, force: true });
    project.provide('databaseUrl', null);
    return undefined;
  }
}
