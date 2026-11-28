// Your own calorie target and the weekly average, in both languages: set in the profile, shown on Today.
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

const addDays = (day: string, n: number) => {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const monday = (day: string) => addDays(day, -((new Date(`${day}T00:00:00Z`).getUTCDay() + 6) % 7));

for (const lang of ['en', 'nl'] as const) {
  const T = (en: string, nl: string) => (lang === 'nl' ? nl : en);

  test(`own calorie target and the weekly average (${lang})`, async ({ page, request }) => {
    const errors = collectErrors(page);
    await request.put('/api/profile', {
      data: { name: 'Test', language: lang, timeZone: '', sex: 'male', age: 40, heightCm: 180, weightKg: 80, neat: 1.4, phase: 'cut', ratePctPerWeek: 0.5 },
    });
    const today: string = (await (await request.get('/api/info')).json()).today;

    await page.goto('/profile');
    await page.locator('.field', { hasText: T('Calorie target', 'Caloriedoel') }).getByRole('button', { name: T('My own', 'Zelf instellen') }).click();
    await page.getByLabel(T('My target on a rest day (kcal)', 'Mijn doel op een rustdag (kcal)')).fill('2100');
    await page.getByLabel(T('Weekly average', 'Weekgemiddelde'), { exact: false }).check();
    await page.getByRole('button', { name: T('Save', 'Opslaan'), exact: true }).click();
    await expect(page.getByText(T('Profile saved', 'Profiel opgeslagen'))).toBeVisible();
    const { profile } = await (await request.get('/api/profile')).json();
    expect([profile.kcalOverride, profile.weekAverage]).toEqual([2100, true]);

    const budget = page.getByRole('region', { name: T('Today’s budget', 'Budget van vandaag') });
    if (today === monday(today)) {
      // A Monday has no days before it this week: just your own target.
      await page.goto('/today');
      await expect(budget).toContainText('2100 kcal');
    } else {
      // Yesterday 1000 kcal over: today gets less, and Today says why.
      await request.put(`/api/diary/entries/${crypto.randomUUID()}`, {
        data: { day: addDays(today, -1), mealId: 3, productId: null, amount: 3100, unit: 'kcal', quick: { name: 'Feest', kcal: 3100, protein: 100, carbs: null, fat: null } },
      });
      await page.goto('/today');
      await expect(budget).toContainText(T('Weekly average:', 'Weekgemiddelde:'));
      await expect(budget).toContainText(T('kcal less today. This week you ate 1000 kcal more than your targets so far', 'kcal minder. Deze week at je tot nu toe 1000 kcal meer dan je doelen'));
    }
    await page.getByRole('link', { name: T('How your target is built', 'Hoe je doel is opgebouwd') }).click();
    await expect(page.getByText(T('Your own target: 2100 kcal a day', 'Je eigen doel: 2100 kcal per dag'), { exact: false })).toBeVisible();
    expect(errors).toEqual([]);
  });
}
