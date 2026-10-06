import type { NextConfig } from 'next';

const isDev = process.env.NODE_ENV === 'development';
/**
 * The embedded worker (local development and end-to-end tests) is compiled in only when it is
 * enabled at build time. Its engine code makes the output tracer include the whole repository,
 * which production deployments must not ship.
 */
const embeddedWorker = process.env.VANILLATE_EMBEDDED_WORKER === '1';

/** Origins the browser talks to directly for uploads and downloads (S3-compatible storage). */
function storageOrigins(): string[] {
  if (process.env.STORAGE_DRIVER !== 's3') return [];
  const endpoint = process.env.S3_PUBLIC_ENDPOINT ?? process.env.S3_ENDPOINT;
  if (!endpoint) return [];
  try {
    const url = new URL(endpoint);
    const origins = [url.origin];
    const bucket = process.env.S3_BUCKET;
    if (bucket && process.env.S3_FORCE_PATH_STYLE === 'false') {
      origins.push(`${url.protocol}//${bucket}.${url.host}`);
    }
    return origins;
  } catch {
    return [];
  }
}

/**
 * Pages are statically generated from the registry, so the policy is static too (nonces would
 * force dynamic rendering). Conversions run in a same-origin Web Worker; files stay in memory
 * (blob: URLs) unless the user chooses server processing, which talks to `storageOrigins()`.
 */
const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ''}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' blob: data:",
  "media-src 'self' blob:",
  "font-src 'self'",
  `connect-src 'self' ${storageOrigins().join(' ')}${isDev ? ' ws: wss:' : ''}`.trim(),
  "worker-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  ...(isDev ? [] : ['upgrade-insecure-requests']),
].join('; ');

const securityHeaders = [
  { key: 'Content-Security-Policy', value: csp },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
  {
    key: 'Permissions-Policy',
    value: 'camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()',
  },
  ...(isDev
    ? []
    : [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains' }]),
];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  reactStrictMode: true,
  // Workspace packages ship TypeScript sources.
  transpilePackages: [
    '@vanillate/browser-engines',
    '@vanillate/catalog',
    '@vanillate/core',
    '@vanillate/engines',
    '@vanillate/jobs',
    '@vanillate/storage',
    '@vanillate/worker',
  ],
  serverExternalPackages: ['postgres'],
  compiler: {
    defineServer: { 'process.env.VANILLATE_EMBEDDED_WORKER': embeddedWorker ? '1' : '0' },
  },
  headers() {
    return Promise.resolve([
      { source: '/:path*', headers: securityHeaders },
      {
        source: '/api/:path*',
        headers: [{ key: 'Cache-Control', value: 'no-store' }],
      },
    ]);
  },
};

export default nextConfig;
