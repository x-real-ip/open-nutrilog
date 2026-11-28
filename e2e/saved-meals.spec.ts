// Saved meals in both languages: save a meal from its menu, log it on another day in one tap, then manage it.
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

  test(`save a meal, log it in one tap, manage it (${lang})`, async ({ page, request }) => {
    const errors = collectErrors(page);
    page.on('dialog', (d) => void d.accept());
    await request.put('/api/profile', { data: { name: 'Test', language: lang, timeZone: '' } });
    const today: string = (await (await request.get('/api/info')).json()).today;

    const per100 = (kcal: number) => ({ kcal, protein: 5, carbs: 10, sugars: null, fat: 1, satFat: null, fibre: null, salt: null });
    const product = async (en: string, nl: string, kcal: number) =>
      (await (await request.post('/api/products', { data: { nameEn: en, nameNl: nl, per100: per100(kcal) } })).json()).product.id as number;
    const oats = await product('Test oats', 'Testhavermout', 370);
    const milk = await product('Test milk', 'Testmelk', 50);
    for (const [productId, amount] of [
      [oats, 100],
      [milk, 200],
    ]) {
      await request.put(`/api/diary/entries/${crypto.randomUUID()}`, { data: { day: today, mealId: 1, productId, amount, unit: 'g' } });
    }
    const name = T('My breakfast', 'Mijn ontbijt');

    const sheet = page.getByRole('dialog');
    const total = page.getByRole('region', { name: T('Total of the day', 'Totaal van de dag') });
    const meal = (en: string, nl: string) => page.getByRole('region', { name: T(en, nl), exact: true });

    // Save breakfast from its menu.
    await page.goto('/diary');
    await expect(total).toContainText('470 kcal');
    await page.getByRole('button', { name: T('Breakfast: options', 'Ontbijt: opties') }).click();
    await sheet.getByRole('button', { name: T('Save as a saved meal…', 'Opslaan als vaste maaltijd…') }).click();
    await sheet.getByLabel(T('Name of the saved meal', 'Naam van de vaste maaltijd')).fill(name);
    await sheet.getByRole('button', { name: T('Save meal', 'Maaltijd opslaan') }).click();
    await expect(sheet).toHaveCount(0);

    // Tomorrow: log it into lunch in one tap.
    await page.getByRole('link', { name: T('Next day', 'Volgende dag') }).click();
    await expect(total).toContainText('0 kcal');
    await meal('Lunch', 'Lunch').getByRole('button', { name: T('Add food', 'Eten toevoegen') }).click();
    await sheet.getByRole('tab', { name: T('Saved meals', 'Vaste maaltijden') }).click();
    await sheet.getByRole('button', { name: new RegExp(name) }).click();
    await expect(total).toContainText('470 kcal');
    await expect(meal('Lunch', 'Lunch')).toContainText(T('Test oats', 'Testhavermout'));
    await expect(meal('Lunch', 'Lunch')).toContainText(T('Test milk', 'Testmelk'));
    await expect(total.getByText(T('not synced yet', 'nog niet gesynchroniseerd'))).toHaveCount(0);
    await page.reload();
    await expect(total).toContainText('470 kcal');

    // Manage: take the milk out, rename, delete.
    await page.goto('/saved-meals');
    const panel = page.getByRole('region', { name });
    await expect(panel).toContainText('470 kcal');
    await panel.getByRole('button', { name: T('Take Test milk out', 'Testmelk weghalen') }).click();
    await expect(panel).toContainText('370 kcal');
    await panel.getByLabel(T('Name', 'Naam'), { exact: true }).fill(T('Oats only', 'Alleen havermout'));
    await panel.getByRole('button', { name: T('Rename', 'Hernoemen') }).click();
    const renamed = page.getByRole('region', { name: T('Oats only', 'Alleen havermout') });
    await expect(renamed).toBeVisible();
    await renamed.getByRole('button', { name: T('Delete', 'Verwijderen') }).click();
    await expect(page.getByText(T('Nothing saved yet.', 'Nog niets opgeslagen.'), { exact: false })).toBeVisible();

    expect(errors).toEqual([]);
  });
}
