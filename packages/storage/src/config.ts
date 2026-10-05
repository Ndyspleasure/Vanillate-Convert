/**
 * Creates the configured storage driver from environment variables.
 *
 *   STORAGE_DRIVER=memory | local | s3
 *   local: STORAGE_LOCAL_DIR, STORAGE_SIGNING_SECRET, STORAGE_PUBLIC_PATH (default /api/v1/storage)
 *   s3:    S3_ENDPOINT, S3_REGION, S3_BUCKET, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY, S3_FORCE_PATH_STYLE
 */
import { LocalStorage } from './local.ts';
import { MemoryStorage } from './memory.ts';
import { S3Storage } from './s3.ts';
import type { Storage } from './types.ts';

export type Env = Readonly<Record<string, string | undefined>>;

function required(env: Env, name: string): string {
  const value = env[name];
  if (!value) throw new Error(`${name} is required for the configured storage driver`);
  return value;
}

export function storageFromEnv(env: Env): Storage | null {
  const driver = env.STORAGE_DRIVER ?? '';
  switch (driver) {
    case '':
      return null;
    case 'memory':
      return new MemoryStorage();
    case 'local':
      return new LocalStorage({
        root: required(env, 'STORAGE_LOCAL_DIR'),
        signingSecret: required(env, 'STORAGE_SIGNING_SECRET'),
        publicPath: env.STORAGE_PUBLIC_PATH ?? '/api/v1/storage',
      });
    case 's3':
      return new S3Storage({
        endpoint: required(env, 'S3_ENDPOINT'),
        region: env.S3_REGION ?? 'auto',
        bucket: required(env, 'S3_BUCKET'),
        accessKeyId: required(env, 'S3_ACCESS_KEY_ID'),
        secretAccessKey: required(env, 'S3_SECRET_ACCESS_KEY'),
        forcePathStyle: (env.S3_FORCE_PATH_STYLE ?? 'true') !== 'false',
      });
    default:
      throw new Error(`unknown STORAGE_DRIVER "${driver}"`);
  }
}
