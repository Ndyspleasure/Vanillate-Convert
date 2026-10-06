import { NextRequest } from 'next/server';
import { describe, expect, it } from 'vitest';

import { LOCALE_COOKIE } from './i18n/config.ts';
import { config, proxy } from './proxy.ts';

function visit(path: string, headers: Record<string, string> = {}): Response {
  return proxy(new NextRequest(new URL(path, 'https://convert.example'), { headers }));
}

describe('proxy', () => {
  it('leaves localized paths alone', () => {
    const response = visit('/id/convert/jpg-ke-png');
    expect(response.headers.get('x-middleware-next')).toBe('1');
  });

  it('redirects to the browser language, straight to the localized slug', () => {
    const response = visit('/convert/jpg-to-png?ref=x', {
      'accept-language': 'id-ID,id;q=0.9,en;q=0.8',
    });
    expect(response.status).toBe(307);
    expect(response.headers.get('location')).toBe(
      'https://convert.example/id/convert/jpg-ke-png?ref=x',
    );
    expect(response.headers.get('vary')).toBe('Accept-Language, Cookie');
  });

  it('prefers the saved language over the browser language', () => {
    const response = visit('/', { 'accept-language': 'id', cookie: `${LOCALE_COOKIE}=en` });
    expect(response.headers.get('location')).toBe('https://convert.example/en');
  });

  it('falls back to English', () => {
    expect(visit('/formats', { 'accept-language': 'fr' }).headers.get('location')).toBe(
      'https://convert.example/en/formats',
    );
  });

  it('does not run for API routes, assets and files', () => {
    const [matcher] = config.matcher;
    const pattern = new RegExp(`^${matcher ?? ''}$`);
    expect(pattern.test('/convert/jpg-to-png')).toBe(true);
    expect(pattern.test('/')).toBe(true);
    expect(pattern.test('/api/v1/jobs')).toBe(false);
    expect(pattern.test('/_next/static/chunk.js')).toBe(false);
    expect(pattern.test('/sitemap.xml')).toBe(false);
    expect(pattern.test('/robots.txt')).toBe(false);
  });
});
