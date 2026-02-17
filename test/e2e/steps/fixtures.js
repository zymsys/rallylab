import { test as base, createBdd } from 'playwright-bdd';

/** Custom test fixture that clears browser storage before each scenario. */
export const test = base.extend({
  page: async ({ page }, use) => {
    // Navigate to base URL first so we have a valid origin for storage APIs
    await page.goto('/');
    await page.evaluate(() => {
      localStorage.clear();
      sessionStorage.clear();
    });
    await use(page);
  },
});

export const { Given, When, Then } = createBdd(test);
