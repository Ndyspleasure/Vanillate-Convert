/** Conversions end to end in a real browser: in the browser, and on the server. */
import { readFile } from 'node:fs/promises';

import { expect, test, type Page } from '@playwright/test';

import { PNG, textPdf } from './fixtures.ts';

/** The conversion widget (the page around it repeats some of its text). */
const converter = (page: Page) => page.locator('section.converter');

async function download(page: Page, name: RegExp): Promise<Buffer> {
  const [file] = await Promise.all([
    page.waitForEvent('download'),
    page
      .getByRole('listitem')
      .filter({ hasText: name })
      .getByRole('link', { name: /Download|Unduh/ })
      .click(),
  ]);
  const path = await file.path();
  return readFile(path);
}

test.describe('in the browser', () => {
  test('CSV to JSON', async ({ page }) => {
    await page.goto('/en/convert/csv-to-json');
    await page.locator('input[type="file"]').setInputFiles({
      name: 'people.csv',
      mimeType: 'text/csv',
      buffer: Buffer.from('name,age\nAda,36\nGrace,45\n'),
    });
    await expect(page.getByText('Detected format: CSV')).toBeVisible();
    await expect(converter(page).getByText(/Runs in your browser/)).toBeVisible();
    await page.getByRole('button', { name: 'Convert', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Results' })).toBeVisible();
    const json = JSON.parse((await download(page, /people\.json/)).toString('utf8')) as unknown;
    expect(json).toEqual([
      { name: 'Ada', age: 36 },
      { name: 'Grace', age: 45 },
    ]);
  });

  test('PNG to JPG with the canvas engine', async ({ page }) => {
    await page.goto('/id/convert/png-ke-jpg');
    await page
      .locator('input[type="file"]')
      .setInputFiles({ name: 'dot.png', mimeType: 'image/png', buffer: PNG });
    await page.getByRole('button', { name: 'Konversi', exact: true }).click();
    const jpg = await download(page, /dot\.jpg/);
    expect([...jpg.subarray(0, 3)]).toEqual([0xff, 0xd8, 0xff]);
  });

  test('JSON formatter with pasted text', async ({ page }) => {
    await page.goto('/en/tools/json-formatter');
    await page.getByRole('button', { name: 'Paste text instead' }).click();
    await page.getByLabel('Text to process').fill('{"b":1,"a":[1,2]}');
    await page.getByRole('button', { name: 'Use this text' }).click();
    await page.getByRole('button', { name: 'Start' }).click();
    const formatted = (await download(page, /\.json/)).toString('utf8');
    expect(formatted).toBe('{\n  "b": 1,\n  "a": [\n    1,\n    2\n  ]\n}\n');
  });

  test('explains when a file is not what the page converts', async ({ page }) => {
    await page.goto('/en/convert/png-to-jpg');
    await page.locator('input[type="file"]').setInputFiles({
      name: 'notes.csv',
      mimeType: 'text/csv',
      buffer: Buffer.from('a,b\n1,2\n'),
    });
    await expect(converter(page).getByRole('alert')).toHaveText(
      'This file looks like CSV, not PNG.',
    );
    await expect(page.getByRole('button', { name: 'Convert', exact: true })).toBeHidden();
  });

  test('from the home page: detects the file and lists possible targets', async ({ page }) => {
    await page.goto('/en');
    await page.locator('input[type="file"]').setInputFiles({
      name: 'data.yaml',
      mimeType: 'application/yaml',
      buffer: Buffer.from('name: Ada\nlanguages:\n  - en\n  - id\n'),
    });
    const select = page.getByLabel('Convert to');
    await expect(select).toBeVisible();
    await select.selectOption('json');
    await page.getByRole('button', { name: 'Convert', exact: true }).click();
    const json = JSON.parse((await download(page, /data\.json/)).toString('utf8')) as unknown;
    expect(json).toEqual({ name: 'Ada', languages: ['en', 'id'] });
  });
});

test.describe('on the server', () => {
  test.beforeEach(async ({ request }) => {
    const health = (await (await request.get('/api/v1/health')).json()) as {
      serverProcessing: { engines: string[] } | null;
    };
    test.skip(!health.serverProcessing?.engines.includes('poppler'), 'Poppler is not installed');
  });

  test('PDF to PNG: upload, process in the worker, download', async ({ page }) => {
    await page.goto('/en/convert/pdf-to-png');
    await page.locator('input[type="file"]').setInputFiles({
      name: 'report.pdf',
      mimeType: 'application/pdf',
      buffer: textPdf(['Page one', 'Page two']),
    });
    await expect(converter(page).getByText(/Runs on our servers/)).toBeVisible();
    await page.getByLabel(/Resolution|DPI/i).fill('50');
    await page.getByRole('button', { name: 'Convert', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Results' })).toBeVisible({ timeout: 60_000 });
    await expect(page.getByText('report-page-1.png')).toBeVisible();
    await expect(page.getByText('report-page-2.png')).toBeVisible();
    const png = await download(page, /report-page-2\.png/);
    expect([...png.subarray(1, 4)]).toEqual([0x50, 0x4e, 0x47]);
  });

  test('the API refuses access without the job token', async ({ request }) => {
    const created = await request.post('/api/v1/jobs', {
      data: {
        target: { kind: 'conversion', from: 'pdf', to: 'png' },
        files: [{ name: 'a.pdf', size: 100, format: 'pdf' }],
      },
    });
    expect(created.status()).toBe(201);
    const { job } = (await created.json()) as { job: { id: string } };
    const anonymous = await request.get(`/api/v1/jobs/${job.id}`);
    expect(anonymous.status()).toBe(403);
    expect(((await anonymous.json()) as { error: { code: string } }).error.code).toBe(
      'unauthorized',
    );
    const wrong = await request.get(`/api/v1/jobs/${job.id}`, {
      headers: { authorization: 'Bearer AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' },
    });
    expect(wrong.status()).toBe(403);
    const cancel = await request.post(`/api/v1/jobs/${job.id}/cancel`);
    expect(cancel.status()).toBe(403);
  });
});
