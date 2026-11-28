// The target engine through the UI: the spec example in both languages, the training-day toggle, the explanation
// and a weigh-in.
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

  test(`spec example: 1982 kcal, 2222 on a training day (${lang})`, async ({ page }) => {
    const errors = collectErrors(page);
    page.on('dialog', (d) => void d.accept());
    await page.goto('/profile');
    if (lang === 'nl') await page.getByRole('button', { name: 'Nederlands' }).click();

    await page.getByRole('button', { name: T('Man', 'Man'), exact: true }).click();
    await page.getByLabel(T('Age', 'Leeftijd'), { exact: true }).fill('40');
    await page.getByLabel(T('Height (cm)', 'Lengte (cm)')).fill('180');
    await page.getByLabel(T('Weight (kg)', 'Gewicht (kg)')).fill('80');
    await page.getByRole('radio', { name: new RegExp(T('Some walking', 'Wat lopen')) }).click();
    await page.getByRole('button', { name: T('Lose fat', 'Afvallen') }).click();
    await page.getByRole('button', { name: T('0.5 % · 0.4 kg', '0,5 % · 0,4 kg') }).click();
    await page.getByLabel(T('Usual training length (min)', 'Gebruikelijke trainingsduur (min)')).fill('45');
    await page.getByRole('button', { name: T('Save', 'Opslaan'), exact: true }).click();
    await expect(page.getByRole('link', { name: T('How your target is built', 'Hoe je doel is opgebouwd') })).toBeVisible();

    const menu = page.getByRole('navigation', { name: T('Main menu', 'Hoofdmenu') });
    await menu.getByRole('link', { name: T('Today', 'Vandaag') }).click();
    const budget = page.getByRole('region', { name: T('Today’s budget', 'Budget van vandaag') });
    await expect(budget).toContainText('1982 kcal');
    await expect(budget).toContainText(T('Rest day', 'Rustdag'));
    await expect(budget.getByRole('meter', { name: T('Protein', 'Eiwit') })).toHaveAttribute('aria-valuemax', '160');

    await budget.getByRole('button', { name: T('Training today', 'Vandaag training') }).click();
    await expect(budget).toContainText('2222 kcal');
    await expect(budget).toContainText(T('incl. 240 kcal training', 'incl. 240 kcal training'));

    await budget.getByRole('link', { name: T('How your target is built', 'Hoe je doel is opgebouwd') }).click();
    await expect(page.getByRole('heading', { level: 1, name: T('How your target is built', 'Hoe je doel is opgebouwd') })).toBeVisible();
    await expect(page.getByText(T('Resting energy (BMR, Mifflin-St Jeor)', 'Ruststofwisseling (BMR, Mifflin-St Jeor)'))).toContainText('1730 kcal');
    await expect(page.getByText(T('a day less', 'per dag minder'))).toContainText('440');

    // A weigh-in on the Progress page becomes the profile weight.
    await menu.getByRole('link', { name: T('Progress', 'Voortgang') }).click();
    await page.getByLabel(T('Weight today in kg', 'Gewicht vandaag in kg')).fill(T('79.5', '79,5'));
    await page.getByRole('button', { name: T('Save today', 'Vandaag opslaan') }).click();
    await expect(page.getByRole('region', { name: T('Body weight', 'Lichaamsgewicht') })).toContainText(T('79.5 kg', '79,5 kg'));
    await menu.getByRole('link', { name: T('Profile', 'Profiel') }).click();
    await expect(page.getByLabel(T('Weight (kg)', 'Gewicht (kg)'))).toHaveValue(T('79.5', '79,5'));

    expect(errors).toEqual([]);
  });
}
