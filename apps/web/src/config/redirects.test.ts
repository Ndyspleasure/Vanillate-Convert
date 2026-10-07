import { describe, expect, it } from 'vitest';

import { canonicalOrigin, hostRedirects } from './redirects.ts';

const production = {
  VERCEL_ENV: 'production',
  NEXT_PUBLIC_SITE_URL: 'https://convert.vanillate.id',
};

describe('hostRedirects', () => {
  it('sends every vercel.app host of a production deployment to the canonical origin', () => {
    expect(hostRedirects(production)).toEqual([
      {
        source: '/:path*',
        has: [{ type: 'host', value: '.+\\.vercel\\.app' }],
        destination: 'https://convert.vanillate.id/:path*',
        permanent: true,
      },
    ]);
    const [rule] = hostRedirects(production);
    const host = new RegExp(`^${rule?.has?.[0]?.value ?? ''}$`);
    expect(host.test('vanillate-convert.vercel.app')).toBe(true);
    expect(host.test('vanillate-convert-fy8rn1y2r-vanillate-studio.vercel.app')).toBe(true);
    expect(host.test('convert.vanillate.id')).toBe(false);
  });

  it('falls back to the production domain Vercel reports', () => {
    const [rule] = hostRedirects({
      VERCEL_ENV: 'production',
      VERCEL_PROJECT_PRODUCTION_URL: 'convert.vanillate.id',
    });
    expect(rule?.destination).toBe('https://convert.vanillate.id/:path*');
  });

  it('leaves previews, local builds and vercel.app-only sites alone', () => {
    expect(hostRedirects({ ...production, VERCEL_ENV: 'preview' })).toEqual([]);
    expect(hostRedirects({ NEXT_PUBLIC_SITE_URL: 'https://convert.vanillate.id' })).toEqual([]);
    expect(
      hostRedirects({
        VERCEL_ENV: 'production',
        VERCEL_PROJECT_PRODUCTION_URL: 'vanillate-convert.vercel.app',
      }),
    ).toEqual([]);
    expect(hostRedirects({ VERCEL_ENV: 'production' })).toEqual([]);
  });
});

describe('canonicalOrigin', () => {
  it('normalizes to an origin and ignores invalid values', () => {
    expect(canonicalOrigin({ NEXT_PUBLIC_SITE_URL: 'https://convert.vanillate.id/' })).toBe(
      'https://convert.vanillate.id',
    );
    expect(canonicalOrigin({ NEXT_PUBLIC_SITE_URL: 'not a url' })).toBeNull();
  });
});
