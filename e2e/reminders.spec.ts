// Reminder times in the profile, in both languages. Pushing itself is covered by server/tests/reminders.test.ts
// (the test browser has no push service to subscribe to).
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

  test(`reminder times in the profile (${lang})`, async ({ page, request }) => {
    const errors = collectErrors(page);
    await request.put('/api/profile', { data: { name: 'Test', language: lang, timeZone: '' } });

    await page.goto('/profile');
    const section = page.getByRole('region', { name: T('Reminders', 'Herinneringen') });
    await expect(section.getByRole('button', { name: T('Turn on notifications on this device', 'Meldingen op dit apparaat aanzetten') })).toBeVisible();
    await section.getByLabel('Lunch').fill('13:00');
    await section.getByLabel(T('Weigh-in', 'Wegen')).fill('08:00');
    await section.getByLabel(T('Summary of the day', 'Samenvatting van de dag')).fill('21:30');
    await page.getByRole('button', { name: T('Save', 'Opslaan'), exact: true }).click();
    await expect(page.getByText(T('Profile saved', 'Profiel opgeslagen'))).toBeVisible();

    const { profile } = await (await request.get('/api/profile')).json();
    expect(profile.reminders).toEqual({ meals: [{ mealId: 2, time: '13:00' }], weighIn: '08:00', summary: '21:30' });

    // Cleared again: no reminders.
    await page.reload();
    await section.getByLabel('Lunch').fill('');
    await page.getByRole('button', { name: T('Save', 'Opslaan'), exact: true }).click();
    await expect(page.getByText(T('Profile saved', 'Profiel opgeslagen'))).toBeVisible();
    expect((await (await request.get('/api/profile')).json()).profile.reminders.meals).toEqual([]);
    expect(errors).toEqual([]);
  });
}
