import { expect } from '@playwright/test';
import { Given, When, Then } from './fixtures.js';

// ─── Navigation ──────────────────────────────────────────────────

Given('I am on the login page', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.login-container')).toBeVisible();
});

Given('I am on the operator page', async ({ page }) => {
  await page.goto('/operator.html');
});

// ─── Auth ────────────────────────────────────────────────────────

When('I sign in with email {string}', async ({ page }, email) => {
  await page.locator('#login-email').fill(email);
  await page.locator('#login-form button[type="submit"]').click();
});

When('I load demo data and sign in', async ({ page }) => {
  await page.locator('#demo-btn').click();
  // Wait for navigation away from login screen
  await expect(page.locator('.screen-title')).toBeVisible({ timeout: 10000 });
});

// ─── Generic Interactions ────────────────────────────────────────

When('I click {string}', async ({ page }, text) => {
  await page.getByRole('button', { name: text }).click();
});

// ─── Pre-Race Interactions ───────────────────────────────────────

When('I create an event named {string} on {string}', async ({ page }, name, date) => {
  await page.getByRole('button', { name: '+ Create Event' }).click();
  await page.locator('#dlg-event-name').fill(name);
  await page.locator('#dlg-event-date').fill(date);
  await page.locator('[data-action="create"]').click();
  // Wait for navigation to event home
  await expect(page.locator('.screen-title')).toBeVisible({ timeout: 10000 });
});

When('I add a section named {string}', async ({ page }, name) => {
  await page.getByRole('button', { name: '+ Add Section' }).click();
  await page.locator('#dlg-section-name').fill(name);
  await page.locator('[data-action="create"]').click();
  // Wait for section to appear in the table
  await expect(page.getByText(name)).toBeVisible({ timeout: 10000 });
});

When('I click {string} for {string}', async ({ page }, buttonText, rowText) => {
  const row = page.locator('tr', { hasText: rowText });
  await row.getByRole('button', { name: buttonText }).click();
});

When('I add a participant named {string}', async ({ page }, name) => {
  await page.getByRole('button', { name: '+ Add Participant' }).click();
  await page.locator('#dlg-participant-name').fill(name);
  await page.locator('[data-action="add"]').click();
  // Wait for name to appear in the roster table (not the toast)
  await expect(page.locator('#roster-body').getByText(name)).toBeVisible({ timeout: 10000 });
});

// ─── Assertions ──────────────────────────────────────────────────

Then('I should see {string}', async ({ page }, text) => {
  await expect(page.getByText(text, { exact: false }).first()).toBeVisible();
});

Then('I should see the heading {string}', async ({ page }, text) => {
  await expect(page.getByRole('heading', { name: text })).toBeVisible();
});

Then('I should see the page title {string}', async ({ page }, title) => {
  await expect(page).toHaveTitle(title);
});

Then('I should see sections with 0 participants each', async ({ page }) => {
  const rows = page.locator('#sections-body tr');
  const count = await rows.count();
  expect(count).toBeGreaterThanOrEqual(2);
  for (let i = 0; i < count; i++) {
    // Second column is participant count
    const cell = rows.nth(i).locator('td').nth(1);
    await expect(cell).toHaveText('0');
  }
});

Then('I should see {string} in the roster', async ({ page }, text) => {
  await expect(page.locator('#roster-body').getByText(text)).toBeVisible();
});

// ─── Demo Data ──────────────────────────────────────────────────

Given('demo data has been loaded', async ({ page }) => {
  await page.locator('#demo-btn').click();
  await expect(page.locator('.screen-title')).toBeVisible({ timeout: 10000 });
  await page.getByRole('button', { name: 'Sign Out' }).click();
  await expect(page.locator('.login-container')).toBeVisible({ timeout: 10000 });
});

When('I sign out', async ({ page }) => {
  await page.getByRole('button', { name: 'Sign Out' }).click();
  await expect(page.locator('.login-container')).toBeVisible({ timeout: 10000 });
});

// ─── Negative Assertions ────────────────────────────────────────

Then('I should not see {string}', async ({ page }, text) => {
  await expect(page.getByText(text, { exact: false }).first()).not.toBeVisible();
});

Then('I should not see the button {string}', async ({ page }, text) => {
  await expect(page.getByRole('button', { name: text, exact: true })).not.toBeVisible();
});
