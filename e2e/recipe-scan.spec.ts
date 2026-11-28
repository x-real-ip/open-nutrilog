// Ingredients by barcode while building a recipe: a known barcode becomes an ingredient right away; an unknown one
// opens a new product with the barcode filled in, which becomes an ingredient once saved.
import { expect, test, type Page } from '@playwright/test';

function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  // The unknown barcode logs a 404 in the console; that is expected here.
  page.on('console', (m) => m.type() === 'error' && !/404/.test(m.text()) && errors.push(m.text()));
  return errors;
}

test.beforeEach(async ({ request }) => {
  const res = await request.post('/api/import/json', { data: { app: 'open-nutrilog', tables: {} } });
  expect(res.ok()).toBeTruthy();
});

for (const lang of ['en', 'nl'] as const) {
  const T = (en: string, nl: string) => (lang === 'nl' ? nl : en);

  test(`scan ingredients into a recipe (${lang})`, async ({ page, request }) => {
    const errors = collectErrors(page);
    await request.put('/api/profile', { data: { name: 'Test', language: lang, timeZone: '' } });
    await request.post('/api/products', {
      data: { nameEn: 'Test oats', nameNl: 'Testhavermout', barcode: '8710400088887', per100: { kcal: 370, protein: 13, carbs: 60, sugars: 1, fat: 7, satFat: 1, fibre: 10, salt: 0 } },
    });

    await page.goto('/recipes/new');
    await page.getByLabel(T('Name', 'Naam'), { exact: true }).fill(T('Porridge', 'Pap'));
    const sheet = page.getByRole('dialog');
    const ingredients = page.getByRole('region', { name: T('Ingredients', 'Ingrediënten') });

    // A known barcode, typed in the scanner (there is no camera in the test browser).
    await page.getByRole('button', { name: T('Add an ingredient', 'Ingrediënt toevoegen') }).click();
    await sheet.getByRole('button', { name: T('Scan', 'Scannen') }).click();
    await sheet.getByLabel(T('Barcode number', 'Barcodenummer')).fill('8710400088887');
    await sheet.getByRole('button', { name: T('Look up', 'Opzoeken') }).click();
    await expect(ingredients).toContainText(T('Test oats', 'Testhavermout'));

    // An unknown barcode: a new product with the barcode filled in; saved, it joins the recipe.
    await page.getByRole('button', { name: T('Add an ingredient', 'Ingrediënt toevoegen') }).click();
    await sheet.getByRole('button', { name: T('Scan', 'Scannen') }).click();
    await sheet.getByLabel(T('Barcode number', 'Barcodenummer')).fill('8710400077776');
    await sheet.getByRole('button', { name: T('Look up', 'Opzoeken') }).click();
    await expect(sheet.getByRole('heading', { name: T('New product', 'Nieuw product') })).toBeVisible();
    await expect(sheet.getByLabel('Barcode')).toHaveValue('8710400077776');
    await sheet.getByLabel(T('Name', 'Naam'), { exact: true }).fill(T('Test milk', 'Testmelk'));
    await sheet.getByLabel(T('Energy (kcal)', 'Energie (kcal)')).fill('46');
    await sheet.getByRole('button', { name: T('Save', 'Opslaan'), exact: true }).click();
    await expect(ingredients).toContainText(T('Test milk', 'Testmelk'));

    await page.getByRole('button', { name: T('Save recipe', 'Recept opslaan') }).click();
    await expect(page).toHaveURL(/\/recipes\/\d+$/);
    expect(errors).toEqual([]);
  });
}
