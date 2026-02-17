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
