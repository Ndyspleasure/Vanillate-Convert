/** Routing, SEO and accessibility of the generated pages. */
import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

test.describe('locale routing', () => {
  test('sends visitors to their language', async ({ request }) => {
    const id = await request.get('/', {
      headers: { 'accept-language': 'id-ID,id;q=0.9,en;q=0.5' },
      maxRedirects: 0,
    });
    expect(id.status()).toBe(307);
    expect(id.headers().location).toMatch(/\/id$/);
    const other = await request.get('/formats', {
      headers: { 'accept-language': 'fr' },
      maxRedirects: 0,
    });
    expect(other.headers().location).toMatch(/\/en\/formats$/);
  });

  test('switching language keeps the page, with the localized slug', async ({ page }) => {
    await page.goto('/en/convert/jpg-to-png');
    await page
      .getByRole('navigation', { name: 'Language' })
      .getByRole('link', { name: 'Bahasa Indonesia' })
      .click();
    await expect(page).toHaveURL(/\/id\/convert\/jpg-ke-png$/);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Konversi JPG ke PNG');
    await expect(page.locator('html')).toHaveAttribute('lang', 'id-ID');
  });
});

test.describe('conversion pages', () => {
  test('are complete landing pages with canonical, alternates and structured data', async ({
    page,
  }) => {
    await page.goto('/en/convert/jpg-to-png');
    await expect(page).toHaveTitle(/Convert JPG to PNG/);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Convert JPG to PNG');
    const canonical = page.locator('link[rel="canonical"]');
    await expect(canonical).toHaveAttribute('href', /\/en\/convert\/jpg-to-png$/);
    await expect(page.locator('link[rel="alternate"][hreflang="id-ID"]')).toHaveAttribute(
      'href',
      /\/id\/convert\/jpg-ke-png$/,
    );
    const ld = await page.locator('script[type="application/ld+json"]').first().textContent();
    const data = JSON.parse(ld ?? '[]') as { '@type': string }[];
    expect(data.map((d) => d['@type'])).toEqual(['BreadcrumbList', 'WebApplication', 'FAQPage']);
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /index/);
  });

  test('aliases redirect to the canonical slug; unsupported pairs do not exist', async ({
    request,
  }) => {
    const alias = await request.get('/en/convert/jpeg-to-png', { maxRedirects: 0 });
    expect(alias.status()).toBe(308);
    expect(alias.headers().location).toMatch(/\/en\/convert\/jpg-to-png$/);
    expect((await request.get('/en/convert/jpg-to-mp3')).status()).toBe(404);
  });

  test('experimental conversions are labeled and not indexed', async ({ page }) => {
    await page.goto('/en/convert/pdf-to-docx');
    await expect(page.locator('.badge--experimental').first()).toHaveText('Experimental');
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/);
  });

  test('the sitemap lists indexable pages only', async ({ request }) => {
    const xml = await (await request.get('/sitemap.xml')).text();
    expect(xml).toContain('/en/convert/jpg-to-png');
    expect(xml).toContain('/id/convert/jpg-ke-png');
    expect(xml).not.toContain('/convert/pdf-to-docx');
  });
});

test('search finds conversions in both languages', async ({ page }) => {
  await page.goto('/id/search?q=heic%20ke%20jpg');
  await expect(page.getByRole('link', { name: 'Konversi HEIC ke JPG' })).toBeVisible();
  await page.goto('/en/search?q=word%20to%20pdf');
  await expect(page.getByRole('link', { name: 'Convert DOCX to PDF' })).toBeVisible();
});

for (const path of [
  '/en',
  '/id/convert/png-ke-jpg',
  '/en/tools/json-formatter',
  '/en/formats/pdf',
  '/en/privacy',
]) {
  test(`has no detectable accessibility violations: ${path}`, async ({ page }) => {
    await page.goto(path);
    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
      .analyze();
    expect(results.violations.map((v) => `${v.id}: ${v.nodes.length}`)).toEqual([]);
  });
}
