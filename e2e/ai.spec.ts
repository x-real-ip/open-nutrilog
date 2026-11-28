// The AI flows against a fake AI provider (e2e/fake-ai.mjs), in both languages: describe a meal, confirm the
// matched lines (one product, one AI estimate), and apply a coach suggestion through the target engine.
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

  test(`describe a meal and apply a coach suggestion (${lang})`, async ({ page, request }) => {
    const errors = collectErrors(page);
    await request.put('/api/profile', {
      data: { name: 'Test', language: lang, timeZone: '', sex: 'male', age: 40, heightCm: 180, weightKg: 80, neat: 1.4, phase: 'cut', ratePctPerWeek: 0.5 },
    });
    await request.post('/api/products', {
      data: { nameEn: 'Test bread', nameNl: 'Testbrood', per100: { kcal: 240, protein: 10, carbs: 40, sugars: 3, fat: 3, satFat: 0.5, fibre: 7, salt: 1.1 } },
    });

    // Describe breakfast; the AI's foods come back matched to products here.
    await page.goto('/diary');
    await page.getByRole('region', { name: T('Breakfast', 'Ontbijt'), exact: true }).getByRole('button', { name: T('Add food', 'Eten toevoegen') }).click();
    const sheet = page.getByRole('dialog');
    await sheet.getByRole('button', { name: T('Describe', 'Beschrijven') }).click();
    await sheet.getByRole('textbox').fill(T('two slices of test bread and a dragon fruit', 'twee sneetjes testbrood en een drakenvrucht'));
    await sheet.getByRole('button', { name: T('Read', 'Lezen'), exact: true }).click();

    const bread = sheet.getByLabel(T('test bread', 'testbrood'), { exact: true });
    // Your own product is the first match (the synthetic NEVO bread from another test may be offered too).
    await expect(bread.getByRole('button', { name: T('Test bread Mine', 'Testbrood Eigen'), exact: true })).toHaveAttribute('aria-pressed', 'true');
    const fruit = sheet.getByLabel(T('dragon fruit', 'drakenvrucht'), { exact: true });
    await expect(fruit.getByRole('button', { name: new RegExp(T('AI estimate', 'AI-schatting')) })).toHaveAttribute('aria-pressed', 'true');
    await sheet.getByRole('button', { name: T('Log 2 · 258 kcal', '2 loggen · 258 kcal') }).click();

    await expect(page.getByRole('region', { name: T('Total of the day', 'Totaal van de dag') })).toContainText('258 kcal');
    await expect(page.getByRole('button', { name: new RegExp(T('dragon fruit', 'drakenvrucht')) })).toContainText(T('AI estimate', 'AI-schatting'));

    // The coach suggests a slower cut; Apply shows what the target engine makes of it; Confirm saves it.
    await page.getByRole('navigation', { name: T('Main menu', 'Hoofdmenu') }).getByRole('link', { name: 'Coach' }).click();
    await page.getByRole('button', { name: T('How am I doing?', 'Hoe gaat het?') }).click();
    const suggestion = page.getByRole('region', { name: T('Suggestion', 'Voorstel') }).or(page.locator('.suggestion'));
    await expect(suggestion).toContainText(T('lose fat, 0.25 % a week', 'afvallen, 0,25 % per week'));
    await suggestion.getByRole('button', { name: T('Apply…', 'Toepassen…') }).click();
    await expect(suggestion).toContainText(T('from 1982 kcal to 2202 kcal', 'van 1982 kcal naar 2202 kcal'));
    await suggestion.getByRole('button', { name: T('Confirm', 'Bevestigen') }).click();
    await expect(page.getByText(T('Your phase is changed', 'Je fase is aangepast'))).toBeVisible();
    const profile = await (await request.get('/api/profile')).json();
    expect(profile.profile.ratePctPerWeek).toBe(0.25);

    expect(errors).toEqual([]);
  });
}

test('the AI settings page shows AI on, the key only as a hint', async ({ page }) => {
  await page.goto('/ai');
  await expect(page.getByText('AI is on')).toBeVisible();
  await expect(page.getByText('e2e-not-a-real-key')).toHaveCount(0);
});
