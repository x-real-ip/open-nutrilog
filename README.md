# Open Nutrilog

A personal, self-hosted calorie and nutrition tracker: a food diary with search, barcode scanning and recipes, daily targets from a deterministic engine, and a link with the strength training app [Open Strength](https://github.com/x-real-ip/open-strength). Mobile-first and fine in a desktop browser (sidebar from 900 px), dark theme, installable as a PWA. Runs in the homelab cluster with PostgreSQL (CloudNativePG) and is deployed through [`x-real-ip/gitops`](https://github.com/x-real-ip/gitops).

> Work in progress. Sign-in, profile, the food diary, your own products and Open Food Facts barcodes work. Targets, NEVO and the OFF text search, recipes, the link with Open Strength and the AI features follow.

## Contents

- [What the app does](#what-the-app-does)
- [Deployment](#deployment)
- [Connecting Authentik](#connecting-authentik)
- [Local development](#local-development)
- [Configuration](#configuration)
- [Backup, export and migration](#backup-export-and-migration)
- [Architecture](#architecture)

## What the app does

- **English or Dutch**: English by default; pick Dutch under Profile → Language. Screens, errors and stored text follow that choice. Numbers use a decimal point in English (42.5) and a comma in Dutch (42,5).
- **Days in your time zone**: a diary day runs from midnight to midnight in `Europe/Amsterdam` (or the `TZ` of the server, or the zone in your profile), whatever the time zone of the device.
- **Diary**: a day per page with breakfast, lunch, dinner and snacks. Rename or hide a meal, or add your own. Swipe through days with the arrows or tap the date to pick one. Each entry shows its energy; the day and every meal show their total, with protein, carbohydrates and fat.
- **Adding food**: search, or pick from *Recent*, *Frequent*, *Favourites* and *My foods*. Amounts in grams or ml, or in servings ("2 × 1 slice"), with energy and macros updating as you type. *Quick add* logs only energy, or energy plus macros, without a product. Copy a meal from the day before, a meal to today, or a whole day.
- **Barcodes**: scan with the camera (the browser's own barcode reader where it has one, such as Chrome on Android or Vanadium on GrapheneOS, otherwise a built-in WebAssembly reader) or type the number. Your own products with that barcode come first; otherwise the server looks it up at [Open Food Facts](https://world.openfoodfacts.org) and keeps a copy. An unknown barcode opens a new product with the barcode filled in.
- **Your own products**: values per 100 g or 100 ml, optional servings and barcode. Editing a product from Open Food Facts saves your own version; the original stays as it is, and deleting your version brings it back. Star a product as a favourite, or hide it from search and lists.
- **Offline**: entries are saved on the phone first (IndexedDB) and sent when there is a connection; the diary shows what is not synced yet. What you ate keeps its values when the product changes later.
- **Data**: export everything as JSON and import such a file again (that replaces all data).

### Open Food Facts

Product data from Open Food Facts is available under the [Open Database License (ODbL)](https://opendatacommons.org/licenses/odbl/1-0/). Only the server talks to OFF, never your browser: with the User-Agent `open-nutrilog/<version> (+https://github.com/x-real-ip/open-nutrilog)`, only the fields the app uses, and at most 60 product lookups per minute (OFF allows 100). Every product is cached in Postgres and fetched again after 30 days. Your own products are never sent to OFF.

## Deployment

The manifests live in [`x-real-ip/gitops`](https://github.com/x-real-ip/gitops) under `manifests/open-nutrilog/`, not in this repo. That is also where the database (CloudNativePG), the migrate init container and the SealedSecrets are.

In short: a release tag `v1.2.3` builds image `ghcr.io/x-real-ip/open-nutrilog:1.2.3`, the workflow sends a dispatch to the gitops repo, which pins the tag in the overlay, and Argo CD rolls it out.

## Connecting Authentik

There are two ways. The app needs no changes for either; it is only configuration.

### Option A: OIDC (recommended)

The app does the OpenID Connect login itself (authorization code + PKCE, through `openid-client`). This works with any gateway and needs no outpost.

1. **Authentik → Applications → Providers → Create → OAuth2/OpenID Provider**
   - Client type: *Confidential*
   - Redirect URI (strict): `https://nutrilog.lan.stamx.nl/api/auth/oidc/callback`
   - Signing key: your default certificate
   - Scopes: the default *openid*, *email* and *profile* (profile also provides `groups`)
   - Leave *Include claims in id_token* on
2. **Applications → Create**: name *Open Nutrilog*, slug `open-nutrilog`, and attach the provider. To only let yourself in, bind a group or user to the application, or use `ALLOWED_USERS`/`ALLOWED_GROUPS`.
3. In the gitops repo (`manifests/open-nutrilog/base/`) set:
   - in `configmap.yaml`: `AUTH_MODE: "oidc"` and `OIDC_CLIENT_ID: "<client id from the provider>"`. `OIDC_ISSUER_URL` is `https://auth.lan.stamx.nl/application/o/open-nutrilog/`.
   - in `sealedsecret.yaml`: the sealed `OIDC_CLIENT_SECRET` (scope `cluster-wide`, controller `sealed-secrets` in `kube-system`).
4. Merge the PR. The login screen now shows *Sign in with Authentik*. Signing out also ends the Authentik session (RP-initiated logout).

`auth.lan.stamx.nl` has a certificate from the internal Stamx CA. The deployment mounts that CA (ConfigMap `stamx-ca`) and sets `NODE_EXTRA_CA_CERTS`, so the app trusts the certificate.

### Option B: forward auth / proxy outpost

An Authentik proxy outpost sits in front of the app and passes the user on in headers (`X-authentik-username`, `-email` and `-groups`). Set `AUTH_MODE: proxy`. Signing out goes to `/outpost.goauthentik.io/sign_out`.

Note: in this mode the app trusts the headers blindly. That is only safe if nothing but the outpost can reach the app.

### Until Authentik is ready

`AUTH_MODE: password` with `APP_PASSWORD` in `open-nutrilog-secrets`.

## Local development

Requires Node.js 22.18 or newer (the server runs TypeScript directly, without a build step) and a Postgres of your choice:

```bash
npm install && npm --prefix web install
export DATABASE_URL=postgres://open_nutrilog:change-me@localhost:5432/open_nutrilog
npm run migrate              # run migrations on their own (idempotent)
npm run dev                  # API on :8080 (also migrates on start)
npm --prefix web run dev     # frontend on :5173, proxies /api to :8080
npm test                     # starts a temporary embedded Postgres per test file
npm run test:e2e             # browser tests (Playwright); needs E2E_DATABASE_URL and npm run build
npm run typecheck            # server and PWA
npm run build                # builds the PWA into web/dist
```

`npm test` needs no running database. `npm run test:e2e` runs the main flow in English and Dutch, on a phone and a desktop viewport, in Chromium; it starts the app itself, wipes the database in `E2E_DATABASE_URL` before every test, and runs in CI before the image is built. Install the browser once with `npx playwright install chromium`. To use an existing test database, set `TEST_DATABASE_URL`. Note: its `public` schema is wiped.

Dependabot opens weekly PRs for npm packages (server and web) and GitHub Actions; minor and patch updates are grouped. The node base image is watched by the *Check releases* workflow.

Agreements for whoever (or whatever) works on the code are in [`CLAUDE.md`](CLAUDE.md).

## Configuration

All settings are environment variables. For local use they are in `.env.example`; in the cluster they come from ConfigMap `open-nutrilog-config` and Secret `open-nutrilog-secrets`.

| Variable | Meaning |
|---|---|
| `PORT`, `LOG_LEVEL` | Port (8080 by default) and log level (`info`, `debug`, …) |
| `APP_URL` | Public URL, needed for OIDC redirects |
| `TZ` | Time zone that decides what a day is (`Europe/Amsterdam` by default); the profile can override it |
| `DATABASE_URL` or `PGHOST`/`PGPORT`/`PGUSER`/`PGPASSWORD`/`PGDATABASE` | Postgres connection |
| `DB_SSL`, `DB_SSL_VERIFY`, `DB_POOL_SIZE` | TLS to Postgres, connection pool |
| `MIGRATE_ON_START` | Run migrations on start (`true` by default; `false` in the cluster, where the init container does it) |
| `AUTH_MODE` | `none`, `password`, `proxy` or `oidc` |
| `SESSION_SECRET`, `SESSION_DAYS` | Signing and lifetime of sessions. Without a secret the app creates one in the database |
| `APP_PASSWORD` | Password for `password` mode |
| `OIDC_ISSUER_URL`, `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET`, `OIDC_SCOPES`, `OIDC_PROVIDER_NAME` | OIDC mode |
| `NODE_EXTRA_CA_CERTS` | Extra CA for outbound TLS, such as the Stamx CA for Authentik |
| `PROXY_USER_HEADER`, `PROXY_EMAIL_HEADER`, `PROXY_GROUPS_HEADER`, `PROXY_LOGOUT_URL` | Proxy mode (the Authentik headers by default) |
| `ALLOWED_USERS`, `ALLOWED_GROUPS` | Optional allowlists (comma-separated) for `oidc` and `proxy`. `ALLOWED_USERS` matches the username or email address |
| `OFF_BASE_URL`, `OFF_TIMEOUT_MS`, `OFF_REFRESH_DAYS` | Open Food Facts API (`https://world.openfoodfacts.org`), request timeout (8000 ms) and how old a cached product may get before it is fetched again (30 days) |

## Backup, export and migration

- **Database**: in the cluster Postgres runs as CloudNativePG cluster `open-nutrilog-db` on a TrueNAS volume. A manual dump: `kubectl -n tools exec open-nutrilog-db-1 -- pg_dump -Fc -U postgres open_nutrilog > open-nutrilog.dump`.
- **Exports in the app** (Profile → Data): JSON with everything. You import a JSON export with *Import from an export file*. That replaces all data.

## Architecture

```
server/                   Fastify API (TypeScript, Node 22+), also serves the built PWA
  index.ts                starts the server
  migrate.ts              standalone migration command (npm run migrate, init container)
  config.ts               environment variables
  db.ts                   PostgreSQL pool, migrations with an advisory lock, query helpers
  auth.ts                 none / password / proxy / oidc, signed session cookie, allowlists
  i18n.ts                 English/Dutch server text, stored text in both languages
  routes/                 core (health, auth, profile), food (products, meals, diary), data (export/import)
  services/
    days.ts               what "a day" is, in the profile's time zone
    profile.ts            the single user's profile
    products.ts           search, lists, your own products, local edits, barcodes and the OFF cache
    off.ts                Open Food Facts: mapping, User-Agent, throttled lookups
    throttle.ts           token bucket for outside APIs
    meals.ts              meals of a day
    diary.ts              entries (PUT by a client id), nutrient snapshots, copying
    dataExport.ts         JSON export and import
  tests/                  node:test with embedded Postgres and a local OIDC provider
shared/types.ts           types shared by server and frontend
shared/nutrition.ts       unit/serving conversion and totals, the same on server and phone
web/                      React + Vite PWA
  src/i18n.ts             UI language: t('English', 'Nederlands') in place
  src/offlineStore.ts     IndexedDB queue for diary changes not yet on the server
  src/barcodeWasm.ts      WebAssembly barcode reader, loaded only without BarcodeDetector
e2e/                      Playwright tests, both languages, phone and desktop
```

The app version is shown next to the logo on the Today screen and under Profile → About the app. `GET /healthz` returns `{"status":"ok","database":"ok"}`, or status 503 when the database does not answer.
