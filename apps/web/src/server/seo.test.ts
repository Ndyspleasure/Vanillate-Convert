import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { paths } from '@vanillate/core';

import { jsonLd, pageMetadata } from './seo.ts';

describe('jsonLd', () => {
  it('cannot close the script element or open a comment', () => {
    const text = jsonLd({ name: '</script><script>alert(1)</script><!--' });
    expect(text).not.toMatch(/<\/script|<!--/i);
    expect(JSON.parse(text)).toEqual({ name: '</script><script>alert(1)</script><!--' });
  });
});

describe('pageMetadata', () => {
  beforeEach(() => vi.stubEnv('NEXT_PUBLIC_SITE_URL', 'https://convert.example/'));
  afterEach(() => vi.unstubAllEnvs());

  it('sets the canonical URL and an alternate for every language', () => {
    const meta = pageMetadata({
      locale: 'id',
      path: (l) => paths.conversion(l, 'jpg', 'png'),
      title: 'JPG ke PNG',
      description: 'Konversi JPG ke PNG.',
    });
    expect(meta.alternates?.canonical).toBe('https://convert.example/id/convert/jpg-ke-png');
    expect(meta.alternates?.languages).toEqual({
      'id-ID': 'https://convert.example/id/convert/jpg-ke-png',
      en: 'https://convert.example/en/convert/jpg-to-png',
      'x-default': 'https://convert.example/en/convert/jpg-to-png',
    });
    expect(meta.robots).toEqual({ index: true, follow: true });
    expect(meta.openGraph).toMatchObject({
      locale: 'id_ID',
      url: 'https://convert.example/id/convert/jpg-ke-png',
    });
  });

  it('marks pages that must not be indexed', () => {
    const meta = pageMetadata({
      locale: 'en',
      path: (l) => paths.conversion(l, 'pdf', 'docx'),
      title: 'PDF to DOCX',
      description: 'Experimental.',
      index: false,
    });
    expect(meta.robots).toEqual({ index: false, follow: true });
  });
});
