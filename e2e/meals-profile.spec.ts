// Choosing the meals the diary shows from the profile, in both languages.
import { expect, test, type Page } from '@playwright/test';

function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  return errors;
}

test.beforeEach(async ({ request }) => {
  const res = await request.post('/api/import/json', { data: { app: 'open-nutrilog', tables: {} } });
  expect(res.ok()).toBeTruthy();
});

for (const lang of ['en', 'nl'] as const) {
  const T = (en: string, nl: string) => (lang === 'nl' ? nl : en);

  test(`choose the meals the diary shows (${lang})`, async ({ page, request }) => {
    const errors = collectErrors(page);
    await request.put('/api/profile', { data: { name: 'Test', language: lang, timeZone: '' } });

    await page.goto('/profile');
    const meals = page.getByRole('region', { name: T('Meals', 'Maaltijden'), exact: true });
    await meals.getByLabel(T('Snacks', 'Tussendoortjes')).uncheck();
    await meals.getByLabel(T('Lunch', 'Lunch')).uncheck();
    await expect(meals.getByLabel(T('Lunch', 'Lunch'))).not.toBeChecked();

    await page.goto('/diary');
    await expect(page.getByRole('region', { name: T('Breakfast', 'Ontbijt'), exact: true })).toBeVisible();
    await expect(page.getByRole('region', { name: T('Dinner', 'Avondeten'), exact: true })).toBeVisible();
    await expect(page.getByRole('region', { name: T('Lunch', 'Lunch'), exact: true })).toHaveCount(0);
    await expect(page.getByRole('region', { name: T('Snacks', 'Tussendoortjes'), exact: true })).toHaveCount(0);

    // Back on; the last meal that is shown can't be turned off.
    await page.goto('/profile');
    await meals.getByLabel(T('Lunch', 'Lunch')).check();
    await meals.getByLabel(T('Breakfast', 'Ontbijt')).uncheck();
    await meals.getByLabel(T('Dinner', 'Avondeten')).uncheck();
    await expect(meals.getByLabel('Lunch')).toBeDisabled();
    await page.goto('/diary');
    await expect(page.getByRole('region', { name: 'Lunch', exact: true })).toBeVisible();
    expect(errors).toEqual([]);
  });
}
