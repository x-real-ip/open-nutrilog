// The offline queue: what you log without a connection shows right away and reaches the server once you are
// back online. The queue doesn't depend on the language, so this runs in English only.
import { expect, test } from '@playwright/test';

test.beforeEach(async ({ request }) => {
  const res = await request.post('/api/import/json', { data: { app: 'open-nutrilog', tables: {} } });
  expect(res.ok()).toBeTruthy();
});

test('logging offline is queued and synced later', async ({ page, context }) => {
  await page.goto('/diary');
  const total = page.getByRole('region', { name: 'Total of the day' });
  await expect(total).toContainText('0 kcal');

  await context.setOffline(true);
  await page.getByRole('region', { name: 'Snacks', exact: true }).getByRole('button', { name: 'Add food' }).click();
  const sheet = page.getByRole('dialog');
  await sheet.getByRole('button', { name: 'Quick add' }).click();
  await sheet.getByLabel('Name (optional)').fill('Apple pie');
  await sheet.getByLabel('Energy (kcal)').fill('320');
  await sheet.getByRole('button', { name: 'Add', exact: true }).click();

  // Shown right away, marked as not on the server yet.
  await expect(total).toContainText('320 kcal');
  await expect(total).toContainText('1 not synced yet');
  await expect(page.getByRole('button', { name: /Apple pie/ })).toBeVisible();

  await context.setOffline(false);
  await expect(total).not.toContainText('not synced yet', { timeout: 20_000 });

  // It is on the server: a fresh load without the queue still shows it.
  const res = await page.request.get(`/api/diary/${await page.evaluate(() => fetch('/api/info').then((r) => r.json()).then((i) => i.today))}`);
  const day = await res.json();
  expect(day.entries.map((e: { name: string }) => e.name)).toEqual(['Apple pie']);
  await page.reload();
  await expect(total).toContainText('320 kcal');
});
