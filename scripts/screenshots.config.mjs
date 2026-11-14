/** Screens captured for the README. Every image shows the synthetic demo extractions. */
const demo = async (page, label) => {
  await page.locator('#today').fill('2026-11-14');
  await page.locator('.demo', { hasText: label }).click();
  await page.locator('.verdict-bar').waitFor();
};

export default {
  shots: [
    {
      file: 'docs/assets/screenshot-home.png',
      viewport: { width: 1440, height: 1060 },
      prepare: async () => {},
    },
    {
      file: 'docs/assets/screenshot-review.png',
      viewport: { width: 1440, height: 1240 },
      prepare: async (page) => {
        await demo(page, 'German agency invoice');
      },
    },
    {
      file: 'docs/assets/screenshot-turkish.png',
      viewport: { width: 1440, height: 1500 },
      prepare: async (page) => {
        // The first error ("VAT total vs line rates") opens selected.
        await demo(page, 'Turkish e-Fatura');
      },
      element: '.ws-grid',
    },
    {
      file: 'docs/assets/screenshot-batch.png',
      viewport: { width: 1440, height: 900 },
      prepare: async (page) => {
        await demo(page, 'Batch of 8 invoices');
        await page.locator('.batch-table tbody tr').nth(5).click();
        await page.evaluate(() => window.scrollTo(0, 0));
      },
    },
    {
      file: 'docs/assets/screenshot-prompt.png',
      viewport: { width: 1440, height: 1600 },
      prepare: async (page) => {
        await demo(page, 'German agency invoice');
        await page.locator('.prompt summary').click();
      },
      element: '.exports',
    },
    {
      file: 'docs/assets/screenshot-mobile.png',
      viewport: { width: 390, height: 844 },
      scale: 2,
      prepare: async (page) => {
        await demo(page, 'German agency invoice');
        await page.evaluate(() => window.scrollTo(0, 0));
      },
    },
  ],
  cards: [{ source: 'docs/assets/social-card.svg', file: 'public/og-image.png', width: 1200, height: 630 }],
};
