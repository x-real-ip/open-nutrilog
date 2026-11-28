// The weekly report in both languages: last week on Today, the report itself, and moving between weeks.
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

  test(`weekly report (${lang})`, async ({ page, request }) => {
    const errors = collectErrors(page);
    await request.put('/api/profile', {
      data: { name: 'Test', language: lang, timeZone: '', sex: 'male', age: 40, heightCm: 180, weightKg: 80, neat: 1.4, phase: 'cut', ratePctPerWeek: 0.5 },
    });
    const today: string = (await (await request.get('/api/info')).json()).today;
    const wk = monday(addDays(today, -7));
    // Three days at 1800 kcal with 120 g protein, one with 170 g.
    for (const [i, protein] of [
      [0, 120],
      [1, 120],
      [2, 170],
    ]) {
      const res = await request.put(`/api/diary/entries/${crypto.randomUUID()}`, {
        data: { day: addDays(wk, i), mealId: 1, productId: null, amount: 1800, unit: 'kcal', quick: { name: T('Test meal', 'Testmaaltijd'), kcal: 1800, protein, carbs: 150, fat: 60 } },
      });
      expect(res.ok()).toBeTruthy();
    }

    // Today shows last week at a glance.
    await page.goto('/');
    const card = page.getByRole('link', { name: T('Last week: weekly report', 'Vorige week: weekoverzicht') });
    await expect(card).toContainText(T('1800 kcal a day', '1800 kcal per dag'));
    await expect(card).toContainText(T('protein 1/3 days', 'eiwit 1/3 dagen'));
    await card.click();

    await expect(page.getByRole('heading', { level: 1, name: T('Last week', 'Vorige week') })).toBeVisible();
    const summary = page.getByRole('region', { name: T('Summary', 'Samenvatting') });
    await expect(summary).toContainText(T('182 kcal a day under your target (1800 kcal against 1982 kcal), over 3 complete days.', '182 kcal per dag onder je doel (1800 kcal tegen 1982 kcal), over 3 complete dagen.'));
    await expect(summary).toContainText('−546');
    await expect(summary).toContainText('1/3');
    await expect(page.getByRole('region', { name: T('Most energy from', 'Meeste energie uit') })).toContainText(T('Test meal', 'Testmaaltijd'));

    // The week before is empty; the next one is this week, with no week after it.
    await page.getByRole('link', { name: T('Previous week', 'Vorige week') }).click();
    await expect(page.getByText(T('Nothing logged this week.', 'Deze week is er niets gelogd.'))).toBeVisible();
    await page.getByRole('link', { name: T('Next week', 'Volgende week') }).click();
    await page.getByRole('link', { name: T('Next week', 'Volgende week') }).click();
    await expect(page.getByRole('heading', { level: 1, name: T('This week', 'Deze week') })).toBeVisible();
    await expect(page.getByRole('link', { name: T('Next week', 'Volgende week') })).toHaveCount(0);

    // Progress links to it too.
    await page.goto('/progress');
    await page.getByRole('link', { name: T('Weekly report', 'Weekoverzicht') }).click();
    await expect(page.getByRole('heading', { level: 1, name: T('Last week', 'Vorige week') })).toBeVisible();
    expect(errors).toEqual([]);
  });
}
