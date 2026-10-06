/**
 * Sandboxed process execution for conversion engines.
 *
 * - Commands run from argument arrays (never a shell), in their own process group, with a
 *   minimal environment (no secrets), and are killed as a group on timeout or cancellation.
 * - `prlimit` (when present) caps CPU time, address space (memory), written file size and
 *   open files.
 * - `bwrap` (when enabled) isolates the process: no network, private /tmp, read-only /usr,
 *   an allowlisted subset of /etc, and only the job directory writable. Other jobs, the
 *   application's environment and credentials are not visible inside the sandbox.
 */
import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';

export type SandboxMode = 'bwrap' | 'none';

export interface RunOptions {
  cwd: string;
  timeoutMs: number;
  signal?: AbortSignal;
  /** Extra environment variables (merged into the minimal environment). */
  env?: Record<string, string>;
  /** Directories the process may write (bound read-write in the sandbox). */
  writable: string[];
  /** Extra read-only paths made visible in the sandbox. */
  readable?: string[];
  /** Bytes of stdout kept (default 4 MiB). */
  stdoutLimit?: number;
  onStdout?: (text: string) => void;
  cpuSeconds?: number;
  /** Largest file the process may write. */
  fileSizeLimit?: number;
  /** Address-space limit in bytes (default: the runner's `memoryBytes`). */
  memoryBytes?: number;
  /** HOME and TMPDIR for the process (default: `<cwd>/home`, `<cwd>/tmp`). */
  homeDir?: string;
  tmpDir?: string;
}

export interface RunResult {
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  /** The tail of stderr (diagnostics only; never shown to users). */
  stderr: string;
  durationMs: number;
  timedOut: boolean;
  aborted: boolean;
}

const PATH = '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin';
const STDERR_KEEP = 16 * 1024;

export function hasCommand(name: string): boolean {
  return spawnSync('sh', ['-c', `command -v "$1"`, 'sh', name], { stdio: 'ignore' }).status === 0;
}

/** /etc entries visible inside the sandbox. */
const SANDBOX_ETC = [
  'alternatives',
  'fonts',
  'ghostscript',
  'group',
  'ImageMagick-6',
  'ImageMagick-7',
  'ld.so.cache',
  'ld.so.conf',
  'ld.so.conf.d',
  'libpaper.d',
  'libreoffice',
  'localtime',
  'mime.types',
  'nsswitch.conf',
  'papersize',
  'passwd',
  'perl',
];

function sandboxArgs(options: RunOptions): string[] {
  const args = [
    '--die-with-parent',
    '--new-session',
    '--unshare-all',
    '--cap-drop',
    'ALL',
    '--ro-bind',
    '/usr',
    '/usr',
    '--ro-bind-try',
    '/opt',
    '/opt',
    '--ro-bind-try',
    '/var/cache/fontconfig',
    '/var/cache/fontconfig',
    '--proc',
    '/proc',
    '--dev',
    '/dev',
    '--tmpfs',
    '/tmp',
  ];
  // Only the parts of /etc that engines need (no credentials, hostnames or service config).
  for (const entry of SANDBOX_ETC) args.push('--ro-bind-try', `/etc/${entry}`, `/etc/${entry}`);
  for (const link of ['bin', 'sbin', 'lib', 'lib64', 'lib32']) {
    if (existsSync(`/usr/${link}`)) args.push('--symlink', `usr/${link}`, `/${link}`);
  }
  for (const path of options.readable ?? []) args.push('--ro-bind', path, path);
  for (const path of options.writable) args.push('--bind', path, path);
  args.push('--chdir', options.cwd);
  return args;
}

let bwrapWorks: boolean | null = null;

/** Whether bubblewrap can create a sandbox here (needs user namespaces or privileges). */
export function bwrapAvailable(): boolean {
  if (bwrapWorks !== null) return bwrapWorks;
  if (!hasCommand('bwrap')) return (bwrapWorks = false);
  const probe = spawnSync(
    'bwrap',
    [...sandboxArgs({ cwd: '/', timeoutMs: 1000, writable: [] }), '--', '/usr/bin/true'],
    {
      stdio: 'ignore',
      timeout: 5000,
    },
  );
  return (bwrapWorks = probe.status === 0);
}

export function resolveSandbox(setting: string | undefined): SandboxMode {
  const mode = (setting ?? 'auto').toLowerCase();
  if (mode === 'none') return 'none';
  if (mode === 'bwrap') {
    if (!bwrapAvailable())
      throw new Error('VANILLATE_SANDBOX=bwrap but bubblewrap cannot create a sandbox here');
    return 'bwrap';
  }
  return bwrapAvailable() ? 'bwrap' : 'none';
}

export interface EngineUser {
  uid: number;
  gid: number;
}

export class ProcessRunner {
  readonly sandbox: SandboxMode;
  /** Unprivileged user the engines run as (when the worker itself runs as root). */
  readonly user: EngineUser | null;
  /** Address-space limit for every engine process, in bytes (null: unlimited). */
  readonly memoryBytes: number | null;
  private readonly prlimit: boolean;

  constructor(options: {
    sandbox: SandboxMode;
    prlimit?: boolean;
    user?: EngineUser | null;
    memoryBytes?: number | null;
  }) {
    this.sandbox = options.sandbox;
    this.user = options.user ?? null;
    this.memoryBytes = options.memoryBytes ?? null;
    this.prlimit = options.prlimit ?? hasCommand('prlimit');
  }

  /**
   * Whether engine processes are isolated from the worker: a bubblewrap sandbox or a separate
   * user that cannot read the worker's environment (`/proc/<pid>/environ`) or other files.
   */
  get isolated(): boolean {
    return this.sandbox === 'bwrap' || this.user !== null;
  }

  run(command: string, args: readonly string[], options: RunOptions): Promise<RunResult> {
    const env: Record<string, string> = {
      PATH,
      HOME: options.homeDir ?? `${options.cwd}/home`,
      TMPDIR: options.tmpDir ?? `${options.cwd}/tmp`,
      LANG: 'C.UTF-8',
      LC_ALL: 'C.UTF-8',
      ...options.env,
    };
    let argv = [command, ...args];
    if (this.prlimit) {
      const limits = ['--nofile=1024'];
      const memory = options.memoryBytes ?? this.memoryBytes;
      if (memory) limits.push(`--as=${Math.ceil(memory)}`);
      if (options.cpuSeconds) limits.push(`--cpu=${Math.ceil(options.cpuSeconds)}`);
      if (options.fileSizeLimit) limits.push(`--fsize=${Math.ceil(options.fileSizeLimit)}`);
      argv = ['prlimit', ...limits, '--', ...argv];
    }
    if (this.sandbox === 'bwrap') argv = ['bwrap', ...sandboxArgs(options), '--', ...argv];
    const [executable, ...rest] = argv as [string, ...string[]];

    return new Promise((resolve, reject) => {
      const started = Date.now();
      const child = spawn(executable, rest, {
        cwd: options.cwd,
        // Deliberately minimal (no inherited variables such as NODE_ENV or secrets). The cast is
        // needed where Next.js types are loaded (apps/web): they make NODE_ENV a required key.
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion
        env: env as NodeJS.ProcessEnv,
        detached: true,
        stdio: ['ignore', 'pipe', 'pipe'],
        ...(this.user ? { uid: this.user.uid, gid: this.user.gid } : {}),
      });
      const stdoutLimit = options.stdoutLimit ?? 4 * 1024 * 1024;
      let stdout = '';
      let stderr = '';
      let timedOut = false;
      let aborted = false;
      const kill = (): void => {
        if (child.pid === undefined) return;
        try {
          process.kill(-child.pid, 'SIGKILL');
        } catch {
          // already exited
        }
      };
      const timer = setTimeout(() => {
        timedOut = true;
        kill();
      }, options.timeoutMs);
      const onAbort = (): void => {
        aborted = true;
        kill();
      };
      options.signal?.addEventListener('abort', onAbort, { once: true });
      if (options.signal?.aborted) onAbort();

      child.stdout.setEncoding('utf8');
      child.stderr.setEncoding('utf8');
      child.stdout.on('data', (chunk: string) => {
        options.onStdout?.(chunk);
        if (stdout.length < stdoutLimit) stdout += chunk.slice(0, stdoutLimit - stdout.length);
      });
      child.stderr.on('data', (chunk: string) => {
        stderr = (stderr + chunk).slice(-STDERR_KEEP);
      });
      child.on('error', (error) => {
        clearTimeout(timer);
        options.signal?.removeEventListener('abort', onAbort);
        reject(error);
      });
      child.on('close', (exitCode, signal) => {
        clearTimeout(timer);
        options.signal?.removeEventListener('abort', onAbort);
        kill(); // reap any leftover children in the group
        resolve({
          exitCode,
          signal,
          stdout,
          stderr,
          durationMs: Date.now() - started,
          timedOut,
          aborted,
        });
      });
    });
  }
}
