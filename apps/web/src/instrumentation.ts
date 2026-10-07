/**
 * Server start hook. With VANILLATE_EMBEDDED_WORKER=1 a processing worker runs inside the web
 * server process: convenient for local development and end-to-end tests. Production runs
 * workers separately (`pnpm worker`), close to the engines and isolated from the web tier.
 *
 * The variable is replaced at build time (next.config.ts), so builds without it do not contain
 * the worker at all.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === 'nodejs' && process.env.VANILLATE_EMBEDDED_WORKER === '1') {
    const { startEmbeddedWorker } = await import('./server/embedded-worker.ts');
    await startEmbeddedWorker();
  }
}
