import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { type VanillateError } from '@vanillate/core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { bwrapAvailable, hasCommand, ProcessRunner } from '../src/runner.ts';
import { assertSuccess } from '../src/util.ts';

let dir: string;

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'vanillate-runner-'));
  await mkdir(join(dir, 'home'));
  await mkdir(join(dir, 'tmp'));
});

afterAll(() => rm(dir, { recursive: true, force: true }));

const options = () => ({ cwd: dir, timeoutMs: 10_000, writable: [dir] });

describe('ProcessRunner', () => {
  const runner = new ProcessRunner({ sandbox: 'none' });

  it('runs commands from argument arrays without a shell', async () => {
    const result = await runner.run('echo', ['$HOME; rm -rf /'], options());
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe('$HOME; rm -rf /\n');
  });

  it('passes a minimal environment without the parent secrets', async () => {
    process.env.VANILLATE_TEST_SECRET = 'do-not-leak';
    try {
      const result = await runner.run('env', [], options());
      expect(result.stdout).not.toContain('do-not-leak');
      expect(result.stdout).toContain(`HOME=${dir}/home`);
      expect(result.stdout).toContain(`TMPDIR=${dir}/tmp`);
    } finally {
      delete process.env.VANILLATE_TEST_SECRET;
    }
  });

  it('kills the whole process group on timeout', async () => {
    const started = Date.now();
    const result = await runner.run('sh', ['-c', 'sleep 30 & sleep 30; echo done'], {
      ...options(),
      timeoutMs: 300,
    });
    expect(result.timedOut).toBe(true);
    expect(result.stdout).not.toContain('done');
    expect(Date.now() - started).toBeLessThan(5_000);
    expect(() => assertSuccess(result, 'test')).toThrow(
      expect.objectContaining({ code: 'conversion-timeout' }) as VanillateError,
    );
  });

  it('stops when the job is cancelled', async () => {
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 100);
    const result = await runner.run('sleep', ['30'], { ...options(), signal: controller.signal });
    expect(result.aborted).toBe(true);
    expect(() => assertSuccess(result, 'test')).toThrow(/cancelled/);
  });

  it('caps stdout and keeps only the stderr tail', async () => {
    const result = await runner.run(
      'sh',
      ['-c', 'head -c 100000 /dev/zero | tr "\\0" a; head -c 40000 /dev/zero | tr "\\0" b >&2'],
      { ...options(), stdoutLimit: 1000 },
    );
    expect(result.stdout.length).toBe(1000);
    expect(result.stderr.length).toBeLessThanOrEqual(16 * 1024);
  });

  it.skipIf(!hasCommand('prlimit'))('enforces the file size limit', async () => {
    const limited = new ProcessRunner({ sandbox: 'none', prlimit: true });
    const result = await limited.run('sh', ['-c', `head -c 2000000 /dev/zero > ${dir}/big`], {
      ...options(),
      fileSizeLimit: 100_000,
    });
    expect(result.exitCode).not.toBe(0);
    expect(() => assertSuccess(result, 'test')).toThrow(
      expect.objectContaining({ code: 'output-too-large' }) as VanillateError,
    );
  });
});

describe.skipIf(!hasCommand('prlimit') || !hasCommand('python3'))('memory limit', () => {
  const script = 'import sys; b = bytearray(256 * 1024 * 1024); sys.stdout.write("allocated")';

  it('stops a process that allocates more than the runner allows', async () => {
    const limited = new ProcessRunner({
      sandbox: 'none',
      prlimit: true,
      memoryBytes: 128 * 1024 ** 2,
    });
    const result = await limited.run('python3', ['-c', script], options());
    expect(result.exitCode).not.toBe(0);
    expect(result.stdout).not.toContain('allocated');
    expect(result.stderr).toMatch(/MemoryError/);
  });

  it('lets a run raise or lower the limit', async () => {
    const limited = new ProcessRunner({
      sandbox: 'none',
      prlimit: true,
      memoryBytes: 128 * 1024 ** 2,
    });
    const result = await limited.run('python3', ['-c', script], {
      ...options(),
      memoryBytes: 1024 ** 3,
    });
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe('allocated');
  });
});

describe.skipIf(!bwrapAvailable())('bubblewrap sandbox', () => {
  const runner = new ProcessRunner({ sandbox: 'bwrap' });

  it('has no network access', async () => {
    const result = await runner.run(
      'sh',
      ['-c', 'cat /proc/net/route 2>/dev/null | wc -l; ls /sys/class/net 2>/dev/null'],
      options(),
    );
    // Only the loopback interface exists in the new network namespace.
    expect(result.stdout).not.toMatch(/eth0|ens|wlan/);
  });

  it('hides /etc files that are not allowlisted and other directories', async () => {
    const result = await runner.run(
      'sh',
      [
        '-c',
        'test -e /etc/hostname && echo hostname; test -e /root && echo root; test -e /etc/fonts && echo fonts',
      ],
      options(),
    );
    expect(result.stdout).not.toContain('hostname');
    expect(result.stdout).not.toContain('root');
    expect(result.stdout).toContain('fonts');
  });

  it('only allows writes inside the job directory', async () => {
    const result = await runner.run(
      'sh',
      ['-c', `touch ${dir}/ok && echo ok; touch /usr/forbidden 2>/dev/null || echo denied`],
      options(),
    );
    expect(result.stdout).toContain('ok');
    expect(result.stdout).toContain('denied');
  });
});
