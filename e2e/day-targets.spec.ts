// Higher days and targets per meal, in both languages: set them in the profile, see them in the diary.
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
/** The first day on or after `day` with this ISO weekday (1 = Monday). */
const next = (day: string, weekday: number) => addDays(day, (weekday - (((new Date(`${day}T00:00:00Z`).getUTCDay() + 6) % 7) + 1) + 7) % 7);

for (const lang of ['en', 'nl'] as const) {
  const T = (en: string, nl: string) => (lang === 'nl' ? nl : en);

  test(`higher days and targets per meal (${lang})`, async ({ page, request }) => {
    const errors = collectErrors(page);
    await request.put('/api/profile', {
      data: { name: 'Test', language: lang, timeZone: '', sex: 'male', age: 40, heightCm: 180, weightKg: 80, neat: 1.4, phase: 'cut', ratePctPerWeek: 0.5 },
    });
    const today: string = (await (await request.get('/api/info')).json()).today;

    await page.goto('/profile');
    const week = page.getByRole('region', { name: T('Over the week', 'Over de week') });
    await week.getByRole('button', { name: T('Sat', 'za'), exact: true }).click();
    await week.getByRole('button', { name: T('Sun', 'zo'), exact: true }).click();
    await expect(week.getByRole('button', { name: '+300 kcal' })).toHaveAttribute('aria-pressed', 'true');
    const perMeal = page.getByRole('region', { name: T('Per meal', 'Per maaltijd') });
    await perMeal.getByRole('button', { name: T('Use a usual split', 'Gebruikelijke verdeling') }).click();
    await expect(perMeal).toContainText(T('Total 100 %', 'Totaal 100 %'));
    await perMeal.getByLabel(T('Snacks (%)', 'Tussendoortjes (%)')).fill('20');
    await page.getByRole('button', { name: T('Save', 'Opslaan'), exact: true }).click();
    await expect(page.getByText(T('add up to 110 %', 'komt uit op 110 %'), { exact: false })).toBeVisible();
    await perMeal.getByLabel(T('Snacks (%)', 'Tussendoortjes (%)')).fill('10');
    await page.getByRole('button', { name: T('Save', 'Opslaan'), exact: true }).click();
    await expect(page.getByText(T('Profile saved', 'Profiel opgeslagen'))).toBeVisible();

    // A Saturday gets 300 kcal more (2282), a Monday 120 less (1862); breakfast is a quarter of it.
    const breakfast = page.getByRole('region', { name: T('Breakfast', 'Ontbijt'), exact: true });
    await page.goto(`/diary/${next(addDays(today, 1), 6)}`);
    await expect(breakfast).toContainText('0 / 571 kcal');
    await page.goto(`/diary/${next(addDays(today, 1), 1)}`);
    await expect(breakfast).toContainText('0 / 466 kcal');
    const sat = await (await request.get(`/api/targets/${next(addDays(today, 1), 6)}`)).json();
    expect(sat.target.kcal).toBe(2282);
    expect(sat.target.steps.map((s: { id: string }) => s.id)).toContain('shift');
    expect(errors).toEqual([]);
  });
}
