/**
 * Values provided by the Vitest global setup (`test/global-setup.ts`) to tests via `inject()`.
 * Shared by every package whose tests read them.
 */
import 'vitest';

declare module 'vitest' {
  export interface ProvidedContext {
    /** PostgreSQL URL for database tests, or null when no database is available. */
    databaseUrl: string | null;
  }
}
