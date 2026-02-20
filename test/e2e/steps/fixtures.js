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
    // Clear IndexedDB (both old and new DB names)
    await page.evaluate(() =>
      Promise.all([
        new Promise(resolve => {
          const req = indexedDB.deleteDatabase('rallylab');
          req.onsuccess = resolve;
          req.onerror = resolve;
          req.onblocked = resolve;
        }),
        new Promise(resolve => {
          const req = indexedDB.deleteDatabase('rallylab-races');
          req.onsuccess = resolve;
          req.onerror = resolve;
          req.onblocked = resolve;
        })
      ])
    );
    await use(page);
  },

  /** Mutable context shared across steps within a single scenario. */
  raceContext: async ({}, use) => {
    await use({
      sectionId: null,
      sectionName: null,
      participants: [],    // [{ car_number, name }]
      checkedIn: [],       // car_number[]
      availableLanes: [],
      completedHeats: 0,
      // Multi-section support (section B)
      sectionIdB: null,
      sectionNameB: null,
      participantsB: [],
      checkedInB: [],
      availableLanesB: [],
      completedHeatsB: 0,
    });
  },
});

export const { Given, When, Then } = createBdd(test);
