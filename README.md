# Open Nutrilog

A personal, self-hosted calorie and nutrition tracker: a food diary with search, barcode scanning and recipes, daily targets from a deterministic engine, and a link with the strength training app [Open Strength](https://github.com/x-real-ip/open-strength). Mobile-first and fine in a desktop browser (sidebar from 900 px), dark theme, installable as a PWA. Runs in the homelab cluster with PostgreSQL (CloudNativePG) and is deployed through [`x-real-ip/gitops`](https://github.com/x-real-ip/gitops).

> Sign-in, the food diary, your own products and recipes, Open Food Facts and NEVO, daily targets, progress, the link with Open Strength and the optional AI features all work.

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
- **Getting around**: the app opens on the diary (or on Today: *Profile → Open the app on*). Sub pages have a back button, and the phone's back button closes an open sheet instead of leaving the page.
- **Meals**: breakfast, lunch, dinner and snacks to start with. Choose which ones the diary shows under *Profile → Meals* (or hide one from its menu in the diary), add your own, and rename them from their menu.
- **Saved meals**: save what you often eat together ("my breakfast") from a meal's menu in the diary, then log it from *Add food → Saved meals* in one tap. Values follow the products; manage them under *Profile → Saved meals*.
- **Several at once**: *Select* in the diary to pick entries, then move them to another meal or day, copy them to one or more days (the coming week in one tap), or delete them. A meal's menu copies the whole meal to other days.
- **Barcodes**: scan with the camera (the browser's own barcode reader where it has one, such as Chrome on Android or Vanadium on GrapheneOS, otherwise a built-in WebAssembly reader) or type the number. Your own products with that barcode come first; otherwise the server looks it up at [Open Food Facts](https://world.openfoodfacts.org) and keeps a copy. An unknown barcode opens a new product with the barcode filled in.
- **Search**: your own products, recipes, favourites and what you ate lately come first, then generic foods from NEVO, then Open Food Facts; each result shows its source. Typos are forgiven ("yoghrt"). When the local search has nothing, the app asks Open Food Facts itself.
- **Recipes**: ingredients from any source, the weight after cooking and the number of portions. Log a recipe as portions or in grams. When an ingredient changes, the recipe follows; what you already logged doesn't.
- **Your own products**: values per 100 g or 100 ml, optional servings and barcode. Editing a product from Open Food Facts saves your own version; the original stays as it is, and deleting your version brings it back. Star a product as a favourite, or hide it from search and lists.
- **Offline**: entries are saved on the phone first (IndexedDB) and sent when there is a connection; the diary shows what is not synced yet. What you ate keeps its values when the product changes later.
- **Targets**: a daily energy and macro target from your profile (sex, age, height, weight, activity outside training, goal and pace). The Today screen shows what is left, protein, carbohydrates and fat against their targets, and whether it is a training day. *Training today* raises the target before you train. *How your target is built* explains every step with your numbers.
- **Progress**: weigh-ins with a smoothed trend and the change per week, energy eaten against the target per day and per week, average macros and protein per kg, and your maintenance per week.
- **Weekly report**: a week looked back on (Monday to Sunday): average intake against the target and the total balance, days the protein target was reached, days fully logged, training days, the trend weight's change, and the foods that gave the most energy. *Today* shows last week at a glance; Progress links to every week.
- **Open Strength (optional)**: linked with [Open Strength](https://github.com/x-real-ip/open-strength), its workouts make a day a training day by themselves (a running workout already counts) and add their energy to the target; *Don't count it* is there for the odd day it shouldn't. This app keeps your body weight: weigh-ins here are sent there (and Open Strength's arrive here), so its starting weights use your current weight; on the first link its weigh-in history comes over once. The profile shows the link, Open Strength's training goal, a gentle note when goal and phase pull different ways, and a button to take age, height and weight from there. Open Strength in turn shows your nutrition phase, uses the last two weeks of eating as context for its coach and program design, and explains stalls with it, without ever changing its weights. Without the link, or when Open Strength is down, you mark training days yourself and nothing else changes.
- **Describe or photograph a meal (AI, optional)**: "2 slices of wholemeal bread with cheese and an apple", or a photo. The AI only lists foods and amounts; the server matches each food to products here through the normal search, and you check every line (another match, another amount, or skip) before anything is logged. Only a food with no match uses the AI's own estimate, and that entry is marked *AI estimate*. A photo is scaled down in the browser first and goes to your AI provider to be read; it is not kept unless you turn that on.
- **Read a nutrition label (AI, optional)**: in a new product, *Read the label from a photo* fills in the values per 100 g or ml, the name, brand and a serving from a photo of the pack. Only what the label says is copied (kJ and sodium are turned into kcal and salt); you check the values and save the product yourself. The photo is not kept.
- **Nutrition coach (AI, optional)**: a chat that sees your targets and how they are built, your last two weeks, your weight trend and, when linked, your training in Open Strength. It explains but never sets targets: a suggested phase or pace comes with *Apply…*, which shows what the target engine makes of it, and only *Confirm* saves it. Without AI it shows the facts.
- **Picnic (optional, experimental)**: link your Picnic account under Profile → Picnic (e-mail, password and the code Picnic texts you). Under Add food → *Picnic* you then see what was delivered in your last five deliveries; tapping one reads its nutrition values from Picnic's product page into a product (source *Picnic*). When Picnic shows no values, the product form opens with what Picnic does say, to complete yourself. Picnic has no official API: this uses the unofficial one (the `picnic-api` package) and may stop working when Picnic changes it. Only reading; your password goes to Picnic only, and only the key Picnic hands out is kept on the server.
- **Data**: export everything as JSON (without NEVO data) and import such a file again (that replaces all data, NEVO stays); the diary as CSV. *Sources* under Profile shows where the data comes from, with the required attributions.

AI is optional: without a key everything works, just without describing or photographing meals, and the coach shows facts.

- **AI settings** (Profile → AI settings and usage): provider (Claude through the official Anthropic SDK, or any OpenAI-compatible API such as Ollama), model, API key, how much the model thinks (separately for the coach and for reading meals), keeping meal photos, and a monthly budget. These settings live in the database and take precedence over the environment variables. The key is never sent to the browser. *Test connection* checks key and model.
- **Usage**: every AI call is recorded with tokens and estimated cost. You see this month, per feature, per day and the latest calls. When the monthly budget is used up, the AI stops until next month.

### How targets work

Targets are **never set by the AI**. They come from a deterministic engine (`server/services/targets.ts`):

- **Resting energy** (BMR, Mifflin-St Jeor): men `10·kg + 6.25·cm − 5·age + 5`, women `… − 161`.
- **Maintenance without training** = BMR × your activity outside training (1.2 mostly sitting, 1.4 some walking, 1.55 on your feet a lot, 1.7 physical work). Training is not in this number, so it is never counted twice.
- **Goal**: `pace × kg × 7700 / 7` kcal a day less (cut) or more (bulk). The pace is capped at 1 % of body weight a week for a cut and 0.5 % for a bulk.
- **Training days**: a day you mark as *Training today* (with your usual training length), or later a workout from Open Strength. It adds `(MET − 1) × kg × hours` (net MET, so the resting part isn't counted twice; MET 5.0 for strength training, at most 2 hours), of which 0, 50 or 100 % counts. With carb cycling on, that energy goes to carbohydrates.
- **Reminders (optional)**: turn on notifications per device (Profile → Reminders) and set times: a meal with nothing logged at its time, no weigh-in yet, and a summary of the day (eaten against target, protein). Times are in the profile's time zone; each reminder goes out at most once a day and only within half an hour of its time. Web Push needs a browser with a push service (Chrome with Google services, Firefox, Safari from the home screen) and outbound HTTPS from the server to it.
- **Fasting (optional)**: turn on the fasting timer in the profile and it shows on Today: start a fast with a goal (12 to 20 hours), see how long it has run and when the goal is reached, end it. On the fasting page you can set an earlier start, change the goal and see or remove earlier fasts. It only keeps time; targets stay the same.
- **Higher days**: pick days that get more (such as the weekend, +100 to +500 kcal). The other days get less by the same total (`extra × higher days / other days` each), so the week adds up to the same and the pace doesn't change. The safety floor still holds on the lower days.
- **Per meal**: optionally split the day's target over the meals in % (adding up to 100). The diary and Today show *eaten / target* per meal; a hidden meal's share is spread over the others.
- **Your own target**: set your own rest-day calorie target instead of the worked-out one (1000–6000 kcal). Training days, higher days and the weekly average still apply and macros follow it. Below your resting energy is allowed (your choice), with a note on Today; lower days and the weekly average then don't go below your own target.
- **Weekly average (optional)**: eat more on a day and the days left in the week get less, eat less and they get more, so the week's average stays on target. Only completely logged days count, at most 300 kcal a day either way, and every Monday starts fresh. Today says when it applies and why; the weekly report measures the week against each day's own target.
- **Macros**: protein 1.8 g/kg (2.0 on a cut) or your own setting; fat at least 25 % of the energy; carbohydrates the rest.
- **Safety floor**: the target never goes below your resting energy; the app says so gently when that happens.
- **Your own maintenance**: after 14 days with at least 10 complete days logged and 8 weigh-ins, the app works out your maintenance from your own data (average intake minus the energy in the change of your trend weight, an EWMA with α 0.1, minus the training energy credited on those days). It is blended with the formula as data grows and moves at most 150 kcal a week. Days you mark as incomplete in the diary are left out.

Spec example (a unit test): a man of 80 kg, 180 cm, 40 years, activity 1.4, cutting 0.5 %/week has BMR 1730, maintenance 2422, −440 for the cut, so 1982 kcal on a rest day. A 45-minute workout adds `(5 − 1) × 80 × 0.75 = 240`, so 2222 kcal on a training day. Protein 2.0 g/kg = 160 g.

### Food data

**NEVO** (RIVM, the Dutch food composition database) gives generic Dutch foods with Dutch and English names. It is free but not open data: you get it only after accepting RIVM's conditions, and it may only be used unchanged with a source reference. So it is **never in this repository or the image**. Download it from [NEVO-online](https://www.rivm.nl/en/dutch-food-composition-database) and import the CSV (or the .zip it comes in) under Profile → Data → *Import NEVO file*, or on the server:

```bash
npm run import:nevo -- NEVO2025_9.0.csv            # the version comes from the file name
npm run import:nevo -- foods.csv --version 2025/9.0
```

The importer finds the columns by their NEVO codes, whatever the delimiter or decimal mark. NEVO rows are read-only; your changes are stored as your own version. Importing a newer version updates the foods by NEVO code. The app shows "Based on data from NEVO-online version …, RIVM, Bilthoven" (or the Dutch text) on Sources. An export contains no NEVO data, only the NEVO codes your entries refer to; importing it into an app with NEVO points them back at the right foods.

**Open Food Facts**: product data from Open Food Facts is available under the [Open Database License (ODbL)](https://opendatacommons.org/licenses/odbl/1-0/). Only the server talks to OFF, never your browser: with the User-Agent `open-nutrilog/<version> (+https://github.com/x-real-ip/open-nutrilog)`, only the fields the app uses, and at most 60 product lookups per minute (OFF allows 100). Every product is cached in Postgres and fetched again after 30 days. Your own products are never sent to OFF. When the local search finds nothing, the app asks OFF's search service (search-a-licious) by itself; with a few results *Search Open Food Facts* asks it on request. At most 8 searches a minute.

For fast local text search, `npm run import:off` streams the official CSV export (`OFF_DUMP_URL`, about 1.5 GB gzipped, 3.7M+ products) through gunzip, keeps the products sold in the Netherlands and Belgium (`OFF_IMPORT_COUNTRIES`) that have an energy value, and upserts them by barcode. It needs no disk and runs as a weekly CronJob in the cluster (suspended until you turn it on). The CSV export has one product name (the product's main language), which for Dutch and Belgian products is usually Dutch. `npm run import:off -- --file dump.csv.gz` imports a file you already have.

## Linking with Open Strength

Both apps talk over a small versioned HTTP API inside the cluster, with a separate token per direction:

| Variable | Meaning |
|---|---|
| `INTEGRATION_TOKEN` | The token Open Strength sends to `/api/integration/v1/*` here. Without it those routes don't exist (404) |
| `STRENGTH_URL`, `STRENGTH_TOKEN` | How this app reaches Open Strength, e.g. `http://open-strength.tools.svc.cluster.local`, and the token Open Strength accepts |

`/api/integration/v1/*` accepts only `Authorization: Bearer <token>` (constant-time), never a session or proxy header:

- `GET /days?from=YYYY-MM-DD&to=YYYY-MM-DD`: `[{ date, kcal, proteinG, carbsG, fatG, targetKcal, targetProteinG, isTrainingDay, complete }]`.
- `GET /phase`: `{ phase, ratePctPerWeek, estimatedTdee, proteinGPerKg, avgProteinGPerKg14d, avgEnergyBalance14d, loggedDays14d }` over the last 14 complete days (`null` without a complete profile).
- `GET /body-weights?from&to`, `PUT /body-weights/:date` (`{ weightKg }`), `DELETE /body-weights/:date`: weigh-ins from Open Strength; stored here and not sent back.

From Open Strength this app reads `/workouts`, `/profile` and (once) `/body-weights`, and writes weigh-ins. Calls time out after 2 s, are cached for a minute, and after a failure the other app is left alone for 15 s; pages never wait for them (the PWA asks `/api/linked/strength` after rendering). Weigh-ins that can't be sent wait in `integration_outbox` and are retried every minute.

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
npm run import:nevo -- <file>  # import the NEVO file you downloaded (CSV or zip)
npm run import:off           # stream the Dutch/Belgian part of the Open Food Facts dump
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
| `OFF_SEARCH_URL` | OFF's search service for the live text search (`https://search.openfoodfacts.org/search`) |
| `INTEGRATION_TOKEN`, `STRENGTH_URL`, `STRENGTH_TOKEN`, `STRENGTH_TIMEOUT_MS` | The optional link with Open Strength (see [Linking with Open Strength](#linking-with-open-strength)) |
| `AI_PROVIDER` | `anthropic` (Claude, the default) or `openai` (any OpenAI-compatible API). Like the other `AI_*` variables only a default: the AI settings in the app take precedence |
| `ANTHROPIC_API_KEY` or `AI_API_KEY` | AI key; stays on the server |
| `AI_MODEL`, `AI_BASE_URL`, `AI_TIMEOUT_MS` | Model (`claude-sonnet-5-5` by default, or `gpt-4o-mini` for `openai`), endpoint, timeout |
| `OFF_DUMP_URL`, `OFF_IMPORT_COUNTRIES` | The CSV export `npm run import:off` streams, and the `countries_tags` it keeps (`en:netherlands,en:belgium`) |

## Backup, export and migration

- **Database**: in the cluster Postgres runs as CloudNativePG cluster `open-nutrilog-db` on a TrueNAS volume. A manual dump: `kubectl -n tools exec open-nutrilog-db-1 -- pg_dump -Fc -U postgres open_nutrilog > open-nutrilog.dump`.
- **Exports in the app** (Profile → Data): JSON with everything except NEVO data, and the diary as CSV. You import a JSON export with *Import from an export file*. That replaces all data; NEVO, which you imported yourself, stays.

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
    off.ts                Open Food Facts: mapping, User-Agent, throttled lookups and search
    offDump.ts            streamed import of the NL/BE part of the OFF dump
    nevo.ts               NEVO: parsing the NEVO-online CSV (or zip), import, attribution
    zip.ts                just enough zip to read the NEVO download
    recipes.ts            recipes: a product worked out from its ingredients
    throttle.ts           token bucket for outside APIs
    meals.ts              meals of a day
    diary.ts              entries (PUT by a client id), nutrient snapshots, copying, moving
    savedMeals.ts         saved meals (a fixed set of foods logged in one tap)
    targets.ts            the target engine: pure functions, BMR, phases, training, macros, adaptive maintenance
    dayTargets.ts         gathers the engine's inputs (profile, weigh-ins, marks, intake) and builds progress
    push.ts               Web Push: VAPID keys and device subscriptions (settings rows, never exported)
    reminders.ts          the reminders, checked every minute, once a day each
    fasting.ts            the fasting timer: one fast at a time, start and end up to 72 hours back
    weekReport.ts         the weekly report (adds up what the diary and the target engine have)
    bodyWeight.ts         weigh-ins; the latest is the profile weight; sent to Open Strength when linked
    strength.ts           the link with Open Strength: workouts, profile, goal clash, weigh-in outbox
    ai.ts                 provider abstraction (Anthropic SDK, OpenAI-compatible), text and images
    aiSettings.ts         AI settings in the app over the environment, price list
    aiUsage.ts            every call recorded; usage summary and the monthly budget
    mealAi.ts             a meal from text or a photo: foods and amounts, matched to products here
    labelAi.ts            a nutrition label from a photo, to fill in a new product
    coach.ts              the nutrition coach: facts as context, suggestions split off for the target engine
    picnic.ts             Picnic (optional): link with 2FA, recent deliveries, reading nutrition values from product pages
    dataExport.ts         JSON export and import (NEVO left out, references kept by code), diary CSV
  scripts/                import:nevo and import:off
  tests/                  node:test with embedded Postgres, a fake OFF and a local OIDC provider; synthetic fixtures only
shared/types.ts           types shared by server and frontend
shared/nutrition.ts       unit/serving conversion and totals, the same on server and phone
web/                      React + Vite PWA
  src/i18n.ts             UI language: t('English', 'Nederlands') in place
  src/offlineStore.ts     IndexedDB queue for diary changes not yet on the server
  src/barcodeWasm.ts      WebAssembly barcode reader, loaded only without BarcodeDetector
e2e/                      Playwright tests, both languages, phone and desktop
```

The app version is shown next to the logo on the Today screen and under Profile → About the app. `GET /healthz` returns `{"status":"ok","database":"ok"}`, or status 503 when the database does not answer.
