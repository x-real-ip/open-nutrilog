// Data sources in both languages: import a (synthetic) NEVO file, see the attribution, build a recipe from a NEVO
// food and log a portion of it.
import fs from 'node:fs';
import { expect, test, type Page } from '@playwright/test';

function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  return errors;
}

const nevo = fs.readFileSync(new URL('../server/tests/fixtures/nevo-synthetic.csv', import.meta.url));

test.beforeEach(async ({ request }) => {
  const res = await request.post('/api/import/json', { data: { app: 'open-nutrilog', tables: {} } });
  expect(res.ok()).toBeTruthy();
});

for (const lang of ['en', 'nl'] as const) {
  const T = (en: string, nl: string) => (lang === 'nl' ? nl : en);

  test(`NEVO import, attribution, a recipe and a logged portion (${lang})`, async ({ page, request }) => {
    const errors = collectErrors(page);
    await request.put('/api/profile', { data: { name: 'Test', language: lang, timeZone: '' } });

    // Import the NEVO file under Profile → Data.
    await page.goto('/profile');
    await page.getByLabel(T('NEVO file', 'NEVO-bestand')).setInputFiles({ name: 'NEVO2025_9.0.csv', mimeType: 'text/csv', buffer: nevo });
    await expect(page.getByText(T('5 NEVO foods imported (version 2025/9.0)', '5 NEVO-voedingsmiddelen geïmporteerd (versie 2025/9.0)'))).toBeVisible();

    // The attribution RIVM asks for, with the version.
    await page.getByRole('link', { name: T('Sources', 'Bronnen') }).click();
    await expect(
      page.getByText(T('Based on data from NEVO-online version 2025/9.0, RIVM, Bilthoven.', 'Gebaseerd op gegevens uit NEVO-online versie 2025/9.0, RIVM, Bilthoven.')),
    ).toBeVisible();
    await expect(page.getByRole('region', { name: 'Open Food Facts' })).toContainText('ODbL');

    // A recipe with 300 g of the NEVO rice, two portions.
    await page.goto('/recipes');
    await page.getByRole('link', { name: T('New recipe', 'Nieuw recept') }).click();
    await page.getByLabel(T('Name', 'Naam'), { exact: true }).fill(T('Rice dish', 'Rijstschotel'));
    await page.getByLabel(T('Portions', 'Porties')).fill('2');
    await page.getByRole('button', { name: T('Add an ingredient', 'Ingrediënt toevoegen') }).click();
    const sheet = page.getByRole('dialog');
    await sheet.getByLabel(T('Search foods', 'Zoek een product')).fill(T('test rice', 'testrijst'));
    await sheet.getByRole('button', { name: new RegExp(T('Test rice boiled', 'Testrijst gekookt')) }).click();
    await page.getByLabel(T('Amount of Test rice boiled', 'Hoeveelheid Testrijst gekookt')).fill('300');
    await expect(page.getByRole('region', { name: T('Per portion', 'Per portie') })).toContainText('197 kcal');
    await page.getByRole('button', { name: T('Save recipe', 'Recept opslaan') }).click();
    await expect(page.getByText(T('Recipe saved', 'Recept opgeslagen'))).toBeVisible();
    await expect(page).toHaveURL(/\/recipes\/\d+$/);

    // Log one portion for dinner.
    await page.goto('/diary');
    await page.getByRole('region', { name: T('Dinner', 'Avondeten'), exact: true }).getByRole('button', { name: T('Add food', 'Eten toevoegen') }).click();
    await sheet.getByLabel(T('Search foods', 'Zoek een product')).fill(T('rice dish', 'rijstschotel'));
    await sheet.getByRole('button', { name: new RegExp(T('Rice dish', 'Rijstschotel')) }).click();
    await expect(sheet.getByRole('button', { name: T('1 portion', '1 portie') })).toHaveAttribute('aria-pressed', 'true');
    await sheet.getByRole('button', { name: T('Add', 'Toevoegen'), exact: true }).click();
    await expect(page.getByRole('region', { name: T('Total of the day', 'Totaal van de dag') })).toContainText('197 kcal');

    expect(errors).toEqual([]);
  });
}
