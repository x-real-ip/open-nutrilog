// The logging flow in both languages: your own product with a serving, search, quick add, edit, delete,
// a barcode typed in by hand, the sync, and copying a day.
import { expect, test, type Page } from '@playwright/test';

function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  // A failed barcode lookup logs a 404 in the console; that is expected here.
  page.on('console', (m) => m.type() === 'error' && !/404/.test(m.text()) && errors.push(m.text()));
  return errors;
}

test.beforeEach(async ({ request }) => {
  const res = await request.post('/api/import/json', { data: { app: 'open-nutrilog', tables: {} } });
  expect(res.ok()).toBeTruthy();
});

for (const lang of ['en', 'nl'] as const) {
  const T = (en: string, nl: string) => (lang === 'nl' ? nl : en);

  test(`log, edit, delete, scan and copy (${lang})`, async ({ page, request }) => {
    const errors = collectErrors(page);
    page.on('dialog', (d) => void d.accept());
    await request.put('/api/profile', { data: { name: 'Test', language: lang, timeZone: '' } });

    const sheet = page.getByRole('dialog');
    const total = page.getByRole('region', { name: T('Total of the day', 'Totaal van de dag') });
    const meal = (en: string, nl: string) => page.getByRole('region', { name: T(en, nl), exact: true });
    const addTo = async (en: string, nl: string) => meal(en, nl).getByRole('button', { name: T('Add food', 'Eten toevoegen') }).click();
    const bread = T('Test bread', 'Testbrood');

    await page.goto('/diary');
    await expect(page.getByRole('heading', { level: 1, name: T('Today', 'Vandaag') })).toBeVisible();

    // Breakfast: a new product with a serving, then two slices of it.
    await addTo('Breakfast', 'Ontbijt');
    await sheet.getByRole('button', { name: T('New', 'Nieuw') }).click();
    await sheet.getByLabel(T('Name', 'Naam'), { exact: true }).fill(bread);
    await sheet.getByLabel('Barcode').fill('8710400099998');
    await sheet.getByLabel(T('Energy (kcal)', 'Energie (kcal)')).fill('240');
    await sheet.getByLabel(T('Protein (g)', 'Eiwit (g)')).fill('10');
    await sheet.getByLabel(T('Carbohydrates (g)', 'Koolhydraten (g)')).fill('40');
    await sheet.getByLabel(T('Fat (g)', 'Vet (g)')).fill('3');
    await sheet.getByRole('button', { name: T('Add a serving', 'Portie toevoegen') }).click();
    await sheet.getByLabel(T('Serving name', 'Naam van de portie')).fill(T('1 slice', '1 snee'));
    await sheet.getByLabel(T('Grams', 'Gram')).fill('35');
    await sheet.getByRole('button', { name: T('Save', 'Opslaan'), exact: true }).click();

    await expect(sheet.getByRole('heading', { name: bread })).toBeVisible();
    // The amount sheet opens without the keyboard; + and − change it (1 slice → 2 → 3 → back to 2).
    await expect(sheet.getByLabel(T('Amount', 'Hoeveelheid'))).not.toBeFocused();
    await sheet.getByRole('button', { name: T('More', 'Meer') }).click();
    await sheet.getByRole('button', { name: T('More', 'Meer') }).click();
    await sheet.getByRole('button', { name: T('Less', 'Minder') }).click();
    await expect(sheet.getByLabel(T('Amount', 'Hoeveelheid'))).toHaveValue('2');
    await expect(sheet.getByText('168 kcal')).toBeVisible();
    await sheet.getByRole('button', { name: T('Add', 'Toevoegen'), exact: true }).click();
    await expect(meal('Breakfast', 'Ontbijt').getByRole('button', { name: new RegExp(bread) })).toContainText(T('2 × 1 slice (70 g)', '2 × 1 snee (70 g)'));
    await expect(total).toContainText('168 kcal');

    // Lunch: found by searching, 100 g.
    await addTo('Lunch', 'Lunch');
    await sheet.getByLabel(T('Search foods', 'Zoek een product')).fill(T('test br', 'testbr'));
    await sheet.getByRole('button', { name: new RegExp(bread) }).click();
    await sheet.getByRole('button', { name: 'g', exact: true }).click();
    await sheet.getByLabel(T('Amount', 'Hoeveelheid')).fill('100');
    await sheet.getByRole('button', { name: T('Add', 'Toevoegen'), exact: true }).click();
    await expect(total).toContainText('408 kcal');

    // Snacks: a quick add.
    await addTo('Snacks', 'Tussendoortjes');
    await sheet.getByRole('button', { name: T('Quick add', 'Snel toevoegen') }).click();
    await sheet.getByLabel(T('Energy (kcal)', 'Energie (kcal)')).fill('250');
    await sheet.getByLabel(T('Protein (g)', 'Eiwit (g)')).fill('10');
    await sheet.getByRole('button', { name: T('Add', 'Toevoegen'), exact: true }).click();
    await expect(total).toContainText('658 kcal');

    // Edit breakfast to three slices; delete lunch.
    await meal('Breakfast', 'Ontbijt').getByRole('button', { name: new RegExp(bread) }).click();
    await sheet.getByLabel(T('Amount', 'Hoeveelheid')).fill('3');
    await sheet.getByRole('button', { name: T('Save', 'Opslaan'), exact: true }).click();
    await expect(total).toContainText('742 kcal');
    await meal('Lunch', 'Lunch').getByRole('button', { name: new RegExp(bread) }).click();
    await sheet.getByRole('button', { name: T('Delete', 'Verwijderen') }).click();
    await expect(total).toContainText('502 kcal');

    // Dinner: the barcode typed in by hand finds your own product.
    await addTo('Dinner', 'Avondeten');
    await sheet.getByRole('button', { name: T('Scan', 'Scannen') }).click();
    await sheet.getByLabel(T('Barcode number', 'Barcodenummer')).fill('8710400099998');
    await sheet.getByRole('button', { name: T('Look up', 'Opzoeken') }).click();
    await expect(sheet.getByRole('heading', { name: bread })).toBeVisible();
    await sheet.getByRole('button', { name: T('Add', 'Toevoegen'), exact: true }).click();
    await expect(total).toContainText('586 kcal');

    // Everything reached the server.
    await expect(total.getByText(T('not synced yet', 'nog niet gesynchroniseerd'))).toHaveCount(0);
    await page.reload();
    await expect(total).toContainText('586 kcal');

    // Today shows the same total.
    await page.getByRole('navigation', { name: T('Main menu', 'Hoofdmenu') }).getByRole('link', { name: T('Today', 'Vandaag') }).click();
    await expect(page.getByRole('region', { name: T('Eaten today', 'Vandaag gegeten') })).toContainText('586 kcal');

    // The next day starts empty and can copy this one.
    await page.goto('/diary');
    await page.getByRole('link', { name: T('Next day', 'Volgende dag') }).click();
    await expect(page.getByRole('heading', { level: 1, name: T('Tomorrow', 'Morgen') })).toBeVisible();
    await expect(total).toContainText('0 kcal');
    await page.getByRole('button', { name: T('Copy the day before', 'Vorige dag kopiëren') }).click();
    await expect(total).toContainText('586 kcal');

    expect(errors).toEqual([]);
  });
}
