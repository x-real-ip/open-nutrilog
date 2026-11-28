// The fasting timer in both languages: start on Today, set an earlier start, reach the goal, end it, see the history.
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

  test(`fasting timer (${lang})`, async ({ page, request }) => {
    const errors = collectErrors(page);
    page.on('dialog', (d) => void d.accept());
    await request.put('/api/profile', { data: { name: 'Test', language: lang, timeZone: '', fasting: true, fastingGoalHours: 16 } });

    await page.goto('/');
    const card = page.getByRole('region', { name: T('Fasting', 'Vasten') });
    await card.getByRole('button', { name: T('14 h', '14 u'), exact: true }).click();
    await card.getByRole('button', { name: T('Start a 14-hour fast', 'Start 14 uur vasten') }).click();
    await expect(card).toContainText(T('0 h 00 min', '0 u 00 min'));
    await expect(card).toContainText(T('Goal 14 h at', 'Doel 14 u om'));

    // I started yesterday evening: 15 hours ago, so the goal is reached.
    await card.getByRole('link', { name: T('History', 'Geschiedenis') }).click();
    await page.getByRole('button', { name: T('I started at another time', 'Ik ben op een ander tijdstip begonnen') }).click();
    const earlier = await page.evaluate(() => {
      const d = new Date(Date.now() - 15 * 3_600_000);
      const p = (n: number) => String(n).padStart(2, '0');
      return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
    });
    await page.getByLabel(T('Start of the fast', 'Start van het vasten')).fill(earlier);
    await page.getByRole('button', { name: T('Save', 'Opslaan'), exact: true }).click();
    const full = page.getByRole('region', { name: T('Fasting', 'Vasten') });
    await expect(full).toContainText(T('15 h 0', '15 u 0'));
    await expect(full).toContainText(T('Goal reached', 'Doel gehaald'));

    await full.getByRole('button', { name: T('End fast', 'Vasten beëindigen') }).click();
    const history = page.locator(`[aria-label="${T('Earlier fasts', 'Eerdere keren')}"]`);
    await expect(history).toContainText(T('15 h 0', '15 u 0'));
    await expect(history).toContainText(T('goal 14 h', 'doel 14 u'));
    await expect(full).toContainText(T('Last fast: 15 h', 'Laatste vasten: 15 u'));

    await history.getByRole('button', { name: new RegExp(T('Remove the fast', 'verwijderen')) }).click();
    await expect(history).toHaveCount(0);
    expect(errors).toEqual([]);
  });
}
