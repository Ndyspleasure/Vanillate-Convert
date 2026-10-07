/**
 * Deployment configuration shared by pages and API routes (server only).
 *
 *   NEXT_PUBLIC_SITE_URL          canonical origin, e.g. https://convert.example.com
 *   VANILLATE_SERVER_PROCESSING   "enabled" when workers, a database and storage exist; any other
 *                                 value builds a browser-only site (server conversions are not
 *                                 offered, listed or indexed)
 */
import 'server-only';

import { getRegistry, type Registry } from '@vanillate/core';

export function siteUrl(): string {
  const explicit = process.env.NEXT_PUBLIC_SITE_URL;
  const vercel = process.env.VERCEL_PROJECT_PRODUCTION_URL;
  const url = explicit ?? (vercel ? `https://${vercel}` : 'http://localhost:3000');
  return url.replace(/\/+$/, '');
}

export function absoluteUrl(path: string): string {
  return `${siteUrl()}${path.startsWith('/') ? path : `/${path}`}`;
}

export function serverProcessingEnabled(): boolean {
  return process.env.VANILLATE_SERVER_PROCESSING === 'enabled';
}

/** The registry for this deployment: identical for pages, API routes and the client widget. */
export function siteRegistry(): Registry {
  return getRegistry(serverProcessingEnabled() ? {} : { disabledModes: ['server'] });
}
