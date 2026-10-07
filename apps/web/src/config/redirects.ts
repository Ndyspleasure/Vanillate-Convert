/**
 * Host redirects, evaluated by next.config.ts at build time.
 *
 * On Vercel, a production deployment also answers on `*.vercel.app` hosts (the project alias
 * such as `vanillate-convert.vercel.app`, and per-deployment URLs). Those duplicate the site
 * under another domain, so production builds send them permanently to the canonical origin,
 * keeping the path and query. Preview deployments keep their own URLs.
 */
import type { NextConfig } from 'next';

type Redirect = Awaited<ReturnType<NonNullable<NextConfig['redirects']>>>[number];

type Env = Readonly<Record<string, string | undefined>>;

/** The canonical origin: `NEXT_PUBLIC_SITE_URL`, else the project's production domain on Vercel. */
export function canonicalOrigin(env: Env): string | null {
  const explicit = env.NEXT_PUBLIC_SITE_URL?.trim();
  const vercel = env.VERCEL_PROJECT_PRODUCTION_URL?.trim();
  const raw = explicit || (vercel ? `https://${vercel}` : '');
  if (!raw) return null;
  try {
    return new URL(raw).origin;
  } catch {
    return null;
  }
}

export function hostRedirects(env: Env): Redirect[] {
  if (env.VERCEL_ENV !== 'production') return [];
  const origin = canonicalOrigin(env);
  // Without a custom domain there is nowhere else to go (and redirecting would loop).
  if (!origin || new URL(origin).hostname.endsWith('.vercel.app')) return [];
  return [
    {
      source: '/:path*',
      has: [{ type: 'host', value: '.+\\.vercel\\.app' }],
      destination: `${origin}/:path*`,
      permanent: true,
    },
  ];
}
