// Bulk actions in the diary, in both languages: pick entries, move them to another meal, copy them to several days,
// copy a whole meal to another day through the meal menu, and delete several at once.
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

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

const addDays = (day: string, n: number) => {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

async function dayOf(request: APIRequestContext, day: string): Promise<[number, string, number][]> {
  const { entries } = await (await request.get(`/api/diary/${day}`)).json();
  return entries.map((e: any) => [e.mealId, e.name, e.amount]);
}

for (const lang of ['en', 'nl'] as const) {
  const T = (en: string, nl: string) => (lang === 'nl' ? nl : en);

  test(`select, move, copy and delete several entries (${lang})`, async ({ page, request }) => {
    const errors = collectErrors(page);
    page.on('dialog', (d) => void d.accept());
    await request.put('/api/profile', { data: { name: 'Test', language: lang, timeZone: '' } });
    const today: string = (await (await request.get('/api/info')).json()).today;

    const per100 = (kcal: number) => ({ kcal, protein: 5, carbs: 10, sugars: null, fat: 1, satFat: null, fibre: null, salt: null });
    const product = async (en: string, nl: string, kcal: number) =>
      (await (await request.post('/api/products', { data: { nameEn: en, nameNl: nl, per100: per100(kcal) } })).json()).product.id as number;
    const oats = await product('Test oats', 'Testhavermout', 370);
    const milk = await product('Test milk', 'Testmelk', 50);
    const apple = await product('Test apple', 'Testappel', 52);
    for (const [productId, mealId, amount] of [
      [oats, 1, 100],
      [milk, 1, 200],
      [apple, 4, 100],
    ]) {
      const res = await request.put(`/api/diary/entries/${crypto.randomUUID()}`, { data: { day: today, mealId, productId, amount, unit: 'g' } });
      expect(res.ok()).toBeTruthy();
    }
    const [oatsName, milkName, appleName] = [T('Test oats', 'Testhavermout'), T('Test milk', 'Testmelk'), T('Test apple', 'Testappel')];

    const sheet = page.getByRole('dialog');
    const total = page.getByRole('region', { name: T('Total of the day', 'Totaal van de dag') });
    const bar = page.getByRole('toolbar', { name: T('Selected items', 'Geselecteerde items') });
    const meal = (en: string, nl: string) => page.getByRole('region', { name: T(en, nl), exact: true });
    const row = (m: ReturnType<typeof meal>, name: string) => m.getByRole('button', { name: new RegExp(name) });
    const select = () => total.getByRole('button', { name: T('Select', 'Selecteren'), exact: true }).click();

    await page.goto('/diary');
    await expect(total).toContainText('522 kcal');

    // Move the milk and the apple to lunch.
    await select();
    await expect(meal('Breakfast', 'Ontbijt').getByRole('button', { name: T('Add food', 'Eten toevoegen') })).toHaveCount(0);
    await row(meal('Breakfast', 'Ontbijt'), milkName).click();
    await row(meal('Snacks', 'Tussendoortjes'), appleName).click();
    await expect(row(meal('Snacks', 'Tussendoortjes'), appleName)).toHaveAttribute('aria-pressed', 'true');
    await expect(bar).toContainText(T('2 selected', '2 geselecteerd'));
    await bar.getByRole('button', { name: T('Move', 'Verplaatsen') }).click();
    await sheet.getByRole('button', { name: 'Lunch', exact: true }).click();
    await sheet.getByRole('button', { name: T('Move', 'Verplaatsen'), exact: true }).click();
    await expect(row(meal('Lunch', 'Lunch'), milkName)).toBeVisible();
    await expect(row(meal('Lunch', 'Lunch'), appleName)).toBeVisible();
    await expect(meal('Snacks', 'Tussendoortjes').getByRole('button', { name: new RegExp(appleName) })).toHaveCount(0);
    await expect(bar).toHaveCount(0);
    await expect(total).toContainText('522 kcal');

    // Copy all of lunch to the next 7 days except tomorrow.
    await select();
    await meal('Lunch', 'Lunch').getByRole('button', { name: T('Lunch: select all', 'Lunch: alles selecteren') }).click();
    await bar.getByRole('button', { name: T('Copy', 'Kopiëren') }).click();
    await sheet.getByRole('button', { name: T('Next 7 days', 'Komende 7 dagen') }).click();
    await sheet.getByRole('button', { name: T('Tomorrow', 'Morgen'), exact: true }).click();
    await sheet.getByRole('button', { name: T('Copy to 6 days', 'Kopiëren naar 6 dagen') }).click();
    await expect(bar).toHaveCount(0);
    expect(await dayOf(request, addDays(today, 1))).toEqual([]);
    for (const n of [2, 7]) {
      expect(await dayOf(request, addDays(today, n))).toEqual([
        [2, milkName, 200],
        [2, appleName, 100],
      ]);
    }
    expect(await dayOf(request, addDays(today, 8))).toEqual([]);

    // Copy the whole breakfast to dinner tomorrow, through the meal menu.
    await page.getByRole('button', { name: T('Breakfast: options', 'Ontbijt: opties') }).click();
    await sheet.getByRole('button', { name: T('Copy to other days…', 'Kopiëren naar andere dagen…') }).click();
    await sheet.getByRole('button', { name: T('Tomorrow', 'Morgen'), exact: true }).click();
    await sheet.getByRole('button', { name: T('Dinner', 'Avondeten'), exact: true }).click();
    await sheet.getByRole('button', { name: T('Copy to 1 day', 'Kopiëren naar 1 dag') }).click();
    await expect(sheet).toHaveCount(0);
    expect(await dayOf(request, addDays(today, 1))).toEqual([[3, oatsName, 100]]);

    // Delete the oats and the apple at once.
    await select();
    await row(meal('Breakfast', 'Ontbijt'), oatsName).click();
    await row(meal('Lunch', 'Lunch'), appleName).click();
    await bar.getByRole('button', { name: T('Delete', 'Verwijderen') }).click();
    await expect(total).toContainText('100 kcal');
    await expect(total.getByText(T('not synced yet', 'nog niet gesynchroniseerd'))).toHaveCount(0);
    await page.reload();
    await expect(total).toContainText('100 kcal');
    expect(await dayOf(request, today)).toEqual([[2, milkName, 200]]);

    expect(errors).toEqual([]);
  });
}
