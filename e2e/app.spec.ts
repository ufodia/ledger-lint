import { expect, test, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';

test('keyboard report navigation keeps focus on findings and filters', async ({ page }) => {
  await demo(page, 'German agency invoice');
  await expect(page.locator('#workspace h1')).toBeFocused();
  await page.locator('#show-all').press('Enter');
  await expect(page.locator('#show-all')).toBeFocused();
  const check = page.locator('.finding').first();
  const id = await check.getAttribute('id');
  await check.press('Enter');
  await expect(page.locator(`[id="${id}"]`)).toBeFocused();
  await page.getByRole('button', { name: 'New check', exact: true }).press('Enter');
  await expect(page.locator('#input')).toBeFocused();
});

test('keyboard findings remain in view in short zoom-sized viewports', async ({ page }) => {
  for (const viewport of [
    { width: 640, height: 512 },
    { width: 320, height: 256 },
  ]) {
    await page.setViewportSize(viewport);
    await demo(page, 'German agency invoice');
    const check = page.locator('[id="finding-line-amount:lines[2].netAmount"]');
    for (let i = 0; i < 100; i++) {
      if (await check.evaluate((element) => element === document.activeElement)) break;
      await page.keyboard.press('Tab');
    }
    await expect(check).toBeFocused();
    for (let activation = 0; activation < 2; activation++) {
      await page.keyboard.press('Enter');
      await expect(check).toBeFocused();
      // Both collapsing and reopening must keep the focused finding in view.
      await page.waitForTimeout(1100);
      await expect(check).toBeInViewport();
    }
  }
});

async function demo(page: Page, label: string) {
  await page.goto('/');
  await page.locator('#today').fill('2026-11-14');
  await page.locator('.demo', { hasText: label }).click();
  await expect(page.locator('.verdict-bar')).toBeVisible();
}

const tally = (page: Page, label: string) => page.locator('.tally', { hasText: label }).locator('strong');
/** A finding by its exact title (the marker number may precede it). Titles here contain no regex characters. */
const finding = (page: Page, title: string) =>
  page
    .locator('.finding')
    .filter({ has: page.locator('.finding-title', { hasText: new RegExp(`^\\d*${title}$`) }) });

test('German demo: verdict, marked fields and the likely cause', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await demo(page, 'German agency invoice');
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await expect(page.locator('.verdict-bar h1')).toHaveText('Does not add up');
  await expect(tally(page, 'Errors')).toHaveText('3');
  await expect(tally(page, 'Passed')).toHaveText('8');
  const line3 = page.locator('[data-field="lines[2].netAmount"]');
  await expect(line3).toHaveClass(/s-error/);
  await expect(line3).toHaveClass(/focus/);
  await expect(line3.locator('.marker')).toHaveText('1');
  const active = page.locator('.finding.active');
  await expect(active).toContainText('Line 3: quantity × unit price');
  await expect(active.locator('.cause')).toContainText('1,000 times too small');
  await expect(active.locator('.suggestion code')).toHaveText('1,230.00');
  await expect(page.locator('.finding', { hasText: 'Subtotal = sum of lines' })).toHaveClass(/s-info/);
  expect(errors).toEqual([]);
});

test('selecting a finding or a field highlights the other', async ({ page }) => {
  await demo(page, 'German agency invoice');
  await finding(page, 'VAT total').click();
  await expect(page.locator('[data-field="vatTotal"]')).toHaveClass(/focus/);
  await expect(page.locator('.finding.active .cause')).toContainText('transposed');
  await page.locator('[data-field="seller.iban"]').click();
  await expect(page.locator('.finding.active')).toContainText('Seller IBAN');
  await expect(page.locator('.finding.active .suggestion code')).toHaveText('DE89 3704 0044 0532 0130 00');
});

test('Turkish e-Fatura: Turkish formatting, outdated rate and withholding', async ({ page }) => {
  await demo(page, 'Turkish e-Fatura');
  await expect(page.locator('[data-field="lines[0].netAmount"]')).toHaveText('55,500.00');
  // The first error is selected when the result opens.
  await expect(finding(page, 'VAT total vs line rates')).toHaveClass(/s-error.*active|active.*s-error/);
  await expect(page.locator('.finding.active .suggestion code')).toHaveText('20%');
  await expect(page.locator('[data-field="lines[2].vatRate"]')).toHaveClass(/focus/);
  await expect(page.locator('.finding', { hasText: 'Amount due' })).toContainText('84,912.00');
  await expect(page.locator('.finding', { hasText: 'VAT rate 18%' })).toHaveClass(/s-warning/);
});

test('a clean Azure result adds up', async ({ page }) => {
  await demo(page, 'Azure Document Intelligence');
  await expect(page.locator('.verdict-bar h1')).toHaveText('Adds up');
  await expect(page.locator('.read-as')).toContainText('Azure Document Intelligence');
  await expect(page.locator('.all-clear')).toBeVisible();
  await page.getByRole('button', { name: /All checks/ }).click();
  await expect(page.locator('.finding.s-pass')).toHaveCount(12);
});

test('batch: table, navigation and duplicates', async ({ page }) => {
  await demo(page, 'Batch of 8 invoices');
  await expect(page.locator('.batch-table tbody tr')).toHaveCount(8);
  await expect(page.locator('.batch-head p')).toHaveText('2 add up · 2 with warnings · 4 do not add up');
  await page.locator('.batch-table tbody tr').nth(1).click();
  await expect(page.locator('.finding', { hasText: 'Possible duplicate' })).toBeVisible();
  await page.locator('.batch-table tbody tr').nth(5).click();
  await expect(page.locator('.verdict-bar .eyebrow')).toContainText('Invoice 6 of 8 · SOD-5521');
  await expect(page.locator('.finding.active .cause')).toContainText('quantity looks wrong');
  await expect(page.locator('[data-field="lines[0].quantity"]')).toHaveClass(/focus/);
});

test('input: errors, JSON Lines, files and editing', async ({ page }) => {
  await page.goto('/');
  await page.locator('#input').fill('{"invoice_number": ');
  await page.getByRole('button', { name: 'Check invoice' }).click();
  await expect(page.locator('#input-error')).toContainText('not valid JSON');
  await page
    .locator('#input')
    .fill(
      '{"number":"A","items":[{"quantity":2,"unit_price":5,"amount":10}],"subtotal":10}\n{"number":"B","total":5}',
    );
  await page.getByRole('button', { name: 'Check invoice' }).click();
  await expect(page.locator('.batch-table tbody tr')).toHaveCount(2);
  await page.getByRole('button', { name: 'Edit the JSON' }).click();
  await expect(page.locator('#input')).toHaveValue(/"number":"B"/);
  await page.locator('#file').setInputFiles({
    name: 'tr.json',
    mimeType: 'application/json',
    buffer: await readFile('examples/tr-efatura.json'),
  });
  await expect(page.locator('.verdict-bar .eyebrow')).toContainText('NLS2026000000137');
});

test('correction prompt and exports', async ({ page, context, baseURL }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: baseURL });
  await demo(page, 'German agency invoice');
  await page.getByRole('button', { name: 'Copy correction prompt' }).click();
  await expect(page.getByRole('button', { name: 'Copied ✓' })).toBeVisible();
  const clip = await page.evaluate(() => navigator.clipboard.readText());
  expect(clip).toContain('line_items[2].amount (line 3 amount)');
  await page.locator('.prompt summary').click();
  await expect(page.locator('.prompt pre')).toContainText('Do not invent values.');

  const [md] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Report (Markdown)' }).click(),
  ]);
  expect(await readFile((await md.path())!, 'utf8')).toContain('# Ledger Lint report');
  const [csv] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Findings (CSV)' }).click(),
  ]);
  expect((await readFile((await csv.path())!, 'utf8')).split('\n')[0]).toBe(
    'invoice,invoice_number,status,group,rule,title,field,source,expected,found,message,cause,suggestion',
  );
  const [json] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Full report (JSON)' }).click(),
  ]);
  const report = JSON.parse(await readFile((await json.path())!, 'utf8'));
  expect(report.invoices[0].verdict).toBe('does-not-add-up');
});

test('no network requests leave the page origin', async ({ page, baseURL }) => {
  const origin = new URL(baseURL!).origin;
  const outside: string[] = [];
  // Local security software (for example Kaspersky web protection) injects its own script into pages
  // served over plain HTTP. Those requests are not made by Ledger Lint, so they are ignored here.
  const injected = /\.kaspersky-labs\.com\//;
  page.on('request', (request) => {
    const url = request.url();
    if (injected.test(url)) return;
    if (!url.startsWith(origin) && !url.startsWith('blob:') && !url.startsWith('data:')) outside.push(url);
  });
  await demo(page, 'Batch of 8 invoices');
  await page.locator('.batch-table tbody tr').nth(2).click();
  expect(outside).toEqual([]);
});

test('phone layout has no horizontal scroll', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await demo(page, 'Turkish e-Fatura');
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  await expect(page.locator('.paper')).toBeVisible();
});

test('malformed provider data and deep JSON show errors and allow recovery', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  await page.locator('#input').fill('{"fields":{"Items":{"type":"array","valueArray":{}}}}');
  await page.getByRole('button', { name: 'Check invoice' }).click();
  await expect(page.locator('#input-error')).toContainText('Azure valueArray must be an array');
  await page.locator('#input').fill('{"invoice":'.repeat(45) + '{}' + '}'.repeat(45));
  await page.getByRole('button', { name: 'Check invoice' }).click();
  await expect(page.locator('#input-error')).toContainText('nesting exceeds');
  await page.locator('.demo', { hasText: 'German agency invoice' }).click();
  await expect(page.locator('.verdict-bar h1')).toHaveText('Does not add up');
  await page.locator('#file').setInputFiles({
    name: 'malformed.json',
    mimeType: 'application/json',
    buffer: Buffer.from('{"fields":{"Items":{"type":"array","valueArray":{}}}}'),
  });
  await expect(page.locator('#input-error')).toBeVisible();
  await expect(page.locator('#input-error')).toContainText('Azure valueArray');
  expect(errors).toEqual([]);
});

test('invoice content is rendered as text and missing arithmetic remains a warning', async ({ page }) => {
  await page.goto('/');
  await page.locator('#input').fill(
    JSON.stringify({
      number: '<img src=x onerror="document.body.dataset.injected=1">',
      currency: 'EUR',
      date: '2026-11-14',
    }),
  );
  await page.getByRole('button', { name: 'Check invoice' }).click();
  await expect(page.locator('.verdict-bar h1')).toHaveText('Check the warnings');
  await expect(page.locator('.finding', { hasText: 'Not enough data to verify arithmetic' })).toBeVisible();
  await expect(page.locator('.paper img')).toHaveCount(0);
  await expect(page.locator('body')).not.toHaveAttribute('data-injected', '1');
});

test('starting a new check discards a pending file read', async ({ page }) => {
  await demo(page, 'German agency invoice');
  await page.evaluate(() => {
    File.prototype.text = () =>
      new Promise<string>((resolve) => {
        Object.assign(window, {
          finishDelayedRead: () => resolve('{"number":"LATE","currency":"EUR","total":1}'),
        });
      });
  });
  await page
    .locator('#file')
    .setInputFiles({ name: 'late.json', mimeType: 'application/json', buffer: Buffer.from('{}') });
  await page.waitForFunction(() => 'finishDelayedRead' in window);
  await page.getByRole('button', { name: 'New check', exact: true }).click();
  await page.evaluate(() => (window as unknown as { finishDelayedRead: () => void }).finishDelayedRead());
  await expect(page.locator('#intro')).toBeVisible();
  await expect(page.locator('#input')).toHaveValue('');
  await expect(page.locator('#workspace')).toBeHidden();
});
