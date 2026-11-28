// The first steps in both languages: open the app, set up a profile, move through the menu.
// Grows into the main flow (diary, targets) in the next phases.
import { expect, test, type Page } from '@playwright/test';

/** Fail the test on any error the page logs or throws. */
function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  return errors;
}

test.beforeEach(async ({ request }) => {
  // Importing an empty export wipes all data, so every test starts without a profile.
  const res = await request.post('/api/import/json', { data: { app: 'open-nutrilog', tables: {} } });
  expect(res.ok()).toBeTruthy();
});

for (const lang of ['en', 'nl'] as const) {
  const T = (en: string, nl: string) => (lang === 'nl' ? nl : en);

  test(`profile → today → diary → progress (${lang})`, async ({ page }) => {
    const errors = collectErrors(page);

    // A new user sees English and is asked to set up a profile.
    await page.goto('/');
    await page.getByRole('link', { name: 'Set up your profile' }).click();
    if (lang === 'nl') await page.getByRole('button', { name: 'Nederlands' }).click();
    await expect(page.getByRole('heading', { name: T('Set up your profile', 'Profiel instellen') })).toBeVisible();

    await page.getByLabel(T('Name', 'Naam')).fill('Test');
    await page.getByRole('button', { name: T('Woman', 'Vrouw') }).click();
    await page.getByLabel(T('Age', 'Leeftijd'), { exact: true }).fill('35');
    await page.getByLabel(T('Height (cm)', 'Lengte (cm)')).fill('168');
    await page.getByLabel(T('Weight (kg)', 'Gewicht (kg)')).fill('64');
    await page.getByRole('button', { name: T('Save', 'Opslaan'), exact: true }).click();
    await expect(page.getByRole('heading', { name: T('Profile', 'Profiel'), exact: true })).toBeVisible();
    // Without Open Strength configured the profile says so; everything else works on its own.
    await expect(page.getByRole('region', { name: 'Open Strength' })).toContainText(T('Not linked', 'Niet gekoppeld'));
    // Picnic is optional: a form to link it, nothing more.
    await expect(page.getByRole('region', { name: 'Picnic' }).getByRole('button', { name: T('Link Picnic', 'Picnic koppelen') })).toBeVisible();

    // The menu: on a phone the bottom bar, on a desktop the sidebar; same links.
    const menu = page.getByRole('navigation', { name: T('Main menu', 'Hoofdmenu') });
    await menu.getByRole('link', { name: T('Today', 'Vandaag') }).click();
    await expect(page.getByRole('heading', { name: T('Today', 'Vandaag'), level: 1 })).toBeVisible();
    await expect(page.getByRole('link', { name: T('Set up your profile', 'Profiel instellen') })).toHaveCount(0);

    await menu.getByRole('link', { name: T('Diary', 'Dagboek') }).click();
    await expect(page.getByRole('heading', { name: T('Today', 'Vandaag'), level: 1 })).toBeVisible();
    await page.getByRole('link', { name: T('Previous day', 'Vorige dag') }).click();
    await expect(page.getByRole('heading', { name: T('Yesterday', 'Gisteren'), level: 1 })).toBeVisible();

    await menu.getByRole('link', { name: T('Progress', 'Voortgang') }).click();
    await expect(page.getByRole('heading', { name: T('Progress', 'Voortgang'), level: 1 })).toBeVisible();

    // The language sticks after a reload: it comes from the profile.
    await page.reload();
    await expect(page.getByRole('heading', { name: T('Progress', 'Voortgang'), level: 1 })).toBeVisible();

    expect(errors).toEqual([]);
  });
}
