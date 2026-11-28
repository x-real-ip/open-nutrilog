// Getting around, in both languages: the app opens on the diary (or Today, by choice), sub pages have a back button,
// and the phone's back button closes an open sheet instead of leaving the page.
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

  test(`start page, back buttons and the back gesture (${lang})`, async ({ page, request }) => {
    const errors = collectErrors(page);
    await request.put('/api/profile', { data: { name: 'Test', language: lang, timeZone: '' } });
    const nav = page.getByRole('navigation', { name: T('Main menu', 'Hoofdmenu') });
    const sheet = page.getByRole('dialog');

    // Opens on the diary.
    await page.goto('/');
    await expect(page).toHaveURL(/\/diary$/);

    // Back closes a sheet, also after going from search to the amount sheet; the page stays.
    await request.post('/api/products', { data: { nameEn: 'Test oats', nameNl: 'Testhavermout', per100: { kcal: 370, protein: 13, carbs: 60, sugars: null, fat: 7, satFat: null, fibre: null, salt: null } } });
    await nav.getByRole('link', { name: T('Today', 'Vandaag') }).click();
    await nav.getByRole('link', { name: T('Diary', 'Dagboek') }).click();
    const addBreakfast = () => page.getByRole('region', { name: T('Breakfast', 'Ontbijt'), exact: true }).getByRole('button', { name: T('Add food', 'Eten toevoegen') }).click();
    await addBreakfast();
    await expect(sheet).toBeVisible();
    await page.goBack();
    await expect(sheet).toHaveCount(0);
    await expect(page).toHaveURL(/\/diary$/);

    await addBreakfast();
    await sheet.getByLabel(T('Search foods', 'Zoek een product')).fill(T('testhav', 'testhav'));
    await sheet.getByRole('button', { name: new RegExp(T('Test oats', 'Testhavermout')) }).click();
    await expect(sheet.getByRole('heading', { name: T('Test oats', 'Testhavermout') })).toBeVisible();
    await page.goBack();
    await expect(sheet).toHaveCount(0);
    await expect(page).toHaveURL(/\/diary$/);

    // A sheet closed by a tap leaves nothing behind: the next back goes to the page before.
    await addBreakfast();
    await page.keyboard.press('Escape');
    await expect(sheet).toHaveCount(0);
    // The app steps back over the sheet's history entry a moment after it closes.
    await page.waitForFunction(() => !(history.state as { nutrilogSheet?: boolean } | null)?.nutrilogSheet);
    await page.goBack();
    await expect(page).toHaveURL(/\/today$/);

    // Sub pages have a back button that goes back where you came from.
    await page.goto('/profile');
    await page.getByRole('link', { name: T('Saved meals', 'Vaste maaltijden') }).click();
    await page.getByRole('button', { name: T('Back', 'Terug') }).click();
    await expect(page).toHaveURL(/\/profile$/);
    // Opened directly, it goes to a sensible page instead of leaving the app.
    await page.goto('/recipes');
    await page.getByRole('button', { name: T('Back', 'Terug') }).click();
    await expect(page).toHaveURL(/\/profile$/);

    // Choose Today as the start page.
    await page.locator('.field', { hasText: T('Open the app on', 'App openen op') }).getByRole('button', { name: T('Today', 'Vandaag') }).click();
    await page.getByRole('button', { name: T('Save', 'Opslaan'), exact: true }).click();
    await expect(page.getByText(T('Profile saved', 'Profiel opgeslagen'))).toBeVisible();
    await page.goto('/');
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByRole('heading', { level: 1, name: T('Today', 'Vandaag') })).toBeVisible();
    expect(errors).toEqual([]);
  });
}
