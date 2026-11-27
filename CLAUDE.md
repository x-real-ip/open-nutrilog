# CLAUDE.md

Working agreements for this repository. Open Nutrilog is the sibling of
[Open Strength](https://github.com/x-real-ip/open-strength): same stack, same layout, same conventions. When Open
Strength has already solved something (auth, migrations, i18n, AI settings, offline queue, CI, release), copy its
approach and adapt it. There is no shared package between the two repos; copying is fine.

## Language

- Code, comments, commits, PRs, release notes and documentation (`README.md`): **English**.
- Everything the user sees exists in **English (default) and Dutch**; the profile's `language` picks one.
  - Web: write text in place as `t('English', 'Nederlands')` (`web/src/i18n.ts`). Numbers through `num()`/`kg()`/`grams()`
    in `web/src/format.ts` (42.5 in English, 42,5 in Dutch), dates through `locale()`.
  - Server: `loc(en, nl)` and `UserError(status, en, nl)` (`server/i18n.ts`); pick with `langOf(profile)`.
    Text that is stored (meal names, target explanations) is stored with both languages via `encode()` and read
    back with `pick()`, so switching language also covers existing data.
  - The AI writes in the profile's language (`AI_LANGUAGE` in `server/i18n.ts`).

## Stack

- Node 22 + TypeScript. The server runs `.ts` directly (type stripping), so there is no
  server build step; `npm run build` builds the PWA in `web/`.
- Fastify serves both the API and the built PWA from one image
  (`ghcr.io/x-real-ip/open-nutrilog`). Don't split it into separate web/api images.
- PostgreSQL only, via `pg`. Schema changes are new entries appended to `migrations` in
  `server/db.ts`; never edit a migration that has shipped. Migrations must stay
  idempotent (`npm run migrate` runs as an init container on every rollout).
- Single user: the profile is the row with `id = 1`.
- Nutrient maths (units, servings, totals) lives in `shared/nutrition.ts` and is used by both the server and the PWA,
  so a queued entry shows the same numbers as after the server saved it. Don't duplicate it.
- Diary entries are written with `PUT /api/diary/entries/:id` by an id the app makes, so the offline queue can retry
  safely. Entries keep a snapshot of name and nutrients; never recompute old entries from a changed product.

## Days and time zones

- "A day" is a calendar day in the profile's time zone (`TZ`, else `Europe/Amsterdam`). Diary days, day totals,
  training days and the date ranges sent between the apps all go through `server/services/days.ts`; never use
  `toISOString().slice(0, 10)` on an instant to get a day.
- The web app takes "today" from `/api/info`, not from the device clock.

## Versions

- The release tag decides the version. CI passes it into the image as `APP_VERSION` (tag `v1.2.3` → `1.2.3`);
  other builds show `dev-<commit>`. `package.json` has no version.
- No version numbers in PRs or commits: not in titles, descriptions or files; the version is chosen when the
  release is published.
- Release notes come from release-drafter (PR titles and labels). PRs do not edit `CHANGELOG.md`.
  Write a clear PR title instead.

## Deployment

- Deploy only via `x-real-ip/gitops` (`manifests/open-nutrilog/`). No Kubernetes manifests in
  this repo.
- A release tag `v*` deploys: CI dispatches to gitops, which pins the image tag. Never
  push to `main` of gitops directly; Argo CD applies it immediately. Use a PR.

## Food data

- **NEVO (RIVM) is not open data.** Never commit NEVO data to this repo and never bake it into the image. It comes
  in only through the import (UI or `npm run import:nevo`), is stored read-only with its version, and is shown with
  the attribution RIVM requires. Tests use a small synthetic fixture in NEVO's format.
- Open Food Facts (ODbL) is fetched by the server only, never by the browser, with a descriptive `User-Agent`,
  throttled, and cached in Postgres. Our own products are never sent to OFF.
- Local edits of a NEVO or OFF product are stored as an override that links to the source; source rows are never
  changed by hand.

## Targets

- Calorie and macro targets come from `server/services/targets.ts` only: deterministic, pure functions, fully
  unit-tested. The AI never sets targets; it may explain them, and a suggested change goes through the engine and
  needs the user's confirmation.
- Keep the spec example green: a man of 80 kg, 180 cm, 40 years, NEAT 1.4, cutting 0.5 %/week → BMR 1730,
  base 2422, cut −440, rest-day target 1982 kcal; a 45-minute workout at MET 5.0 adds 240 → 2222 kcal; protein
  2.0 g/kg = 160 g.

## Integration with Open Strength

- Both apps work fully when the other is down or not configured; linked features degrade quietly. Never block a
  page load on the other app: render first, then add the linked data.
- `/api/integration/v1/*` accepts only a bearer token (constant-time compare) and answers 404 when no token is
  configured. A session cookie is not enough.

## Checks before a PR

```bash
npm run typecheck && npm test && npm run build
yamllint .
E2E_DATABASE_URL=postgres://… npm run test:e2e   # browser tests; also run in CI
```

Change UI text or flows? Update the e2e tests too: they click through the app by visible text, in both languages.

CI builds the image from the `Dockerfile`; there is no Docker setup for local use.
