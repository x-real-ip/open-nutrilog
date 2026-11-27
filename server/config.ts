import path from 'node:path';

const env = process.env;

/** Empty strings (common in .env files and ConfigMaps) count as unset. */
function str(name: string): string | undefined {
  const v = env[name]?.trim();
  return v ? v : undefined;
}

function num(name: string, fallback: number): number {
  const v = Number(env[name]);
  return Number.isFinite(v) && v > 0 ? v : fallback;
}

function bool(name: string, fallback: boolean): boolean {
  const v = str(name)?.toLowerCase();
  if (v === undefined) return fallback;
  return ['1', 'true', 'yes', 'on'].includes(v);
}

function list(name: string): string[] {
  return (str(name) ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

export type AuthMode = 'none' | 'password' | 'proxy' | 'oidc';

function authMode(): AuthMode {
  const m = str('AUTH_MODE')?.toLowerCase();
  if (m === 'none' || m === 'password' || m === 'proxy' || m === 'oidc') return m;
  // Backwards compatible default: a password turns on password mode.
  return str('APP_PASSWORD') ? 'password' : 'none';
}

const LOG_LEVELS = ['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'] as const;
type LogLevel = (typeof LOG_LEVELS)[number];

function logLevel(): LogLevel {
  const v = str('LOG_LEVEL')?.toLowerCase();
  return (LOG_LEVELS as readonly string[]).includes(v ?? '') ? (v as LogLevel) : 'info';
}

/**
 * The release tag decides the version: CI passes it into the image as APP_VERSION (tag v1.2.3 → 1.2.3).
 * Builds without a tag carry dev-<commit>; running from source shows "dev".
 */
function appVersion(): string {
  return str('APP_VERSION') ?? 'dev';
}

/** A time zone name Intl understands, or undefined. */
export function validTimeZone(tz: string | undefined): string | undefined {
  if (!tz) return undefined;
  try {
    new Intl.DateTimeFormat('en-CA', { timeZone: tz });
    return tz;
  } catch {
    return undefined;
  }
}

export const config = {
  port: num('PORT', 8080),
  host: str('HOST') ?? '0.0.0.0',
  webDir: path.resolve(str('WEB_DIR') ?? './web/dist'),
  logLevel: logLevel(),
  /** Public base URL, e.g. https://nutrilog.lan.stamx.nl (needed for OIDC redirects). PUBLIC_URL is the old name. */
  publicUrl: (str('APP_URL') ?? str('PUBLIC_URL') ?? '').replace(/\/$/, ''),

  // Database: DATABASE_URL, or the standard PGHOST/PGPORT/PGUSER/PGPASSWORD/PGDATABASE variables.
  databaseUrl: str('DATABASE_URL') ?? '',
  dbPoolSize: num('DB_POOL_SIZE', 10),
  dbSsl: bool('DB_SSL', false),
  dbSslVerify: bool('DB_SSL_VERIFY', true),
  /** Run pending migrations at startup. Turn off when an init container runs `npm run migrate`. */
  migrateOnStart: bool('MIGRATE_ON_START', true),

  auth: {
    mode: authMode(),
    password: str('APP_PASSWORD') ?? '',
    sessionSecret: str('SESSION_SECRET') ?? '',
    sessionDays: num('SESSION_DAYS', 30),
    // Forward-auth / reverse proxy (e.g. Authentik proxy outpost) passes the user in a header.
    proxyUserHeader: (str('PROXY_USER_HEADER') ?? 'x-authentik-username').toLowerCase(),
    proxyEmailHeader: (str('PROXY_EMAIL_HEADER') ?? 'x-authentik-email').toLowerCase(),
    proxyGroupsHeader: (str('PROXY_GROUPS_HEADER') ?? 'x-authentik-groups').toLowerCase(),
    // Authentik proxy outposts serve this path on the application's own domain.
    proxyLogoutUrl: str('PROXY_LOGOUT_URL') ?? '/outpost.goauthentik.io/sign_out',
    // Native OpenID Connect (e.g. Authentik OAuth2/OpenID provider).
    // OIDC_ISSUER is the old name.
    oidcIssuer: str('OIDC_ISSUER_URL') ?? str('OIDC_ISSUER') ?? '',
    oidcClientId: str('OIDC_CLIENT_ID') ?? '',
    oidcClientSecret: str('OIDC_CLIENT_SECRET') ?? '',
    oidcScopes: str('OIDC_SCOPES') ?? 'openid profile email',
    oidcProviderName: str('OIDC_PROVIDER_NAME') ?? 'Authentik',
    oidcAllowInsecure: bool('OIDC_ALLOW_INSECURE', false),
    // Optional allowlists, checked against username/email and the groups claim/header.
    allowedUsers: list('ALLOWED_USERS').map((u) => u.toLowerCase()),
    allowedGroups: list('ALLOWED_GROUPS'),
  },

  /** Open Food Facts: barcode lookups (and later the live search) go to this API. */
  off: {
    baseUrl: (str('OFF_BASE_URL') ?? 'https://world.openfoodfacts.org').replace(/\/$/, ''),
    timeoutMs: num('OFF_TIMEOUT_MS', 8000),
    /** A cached product is fetched again after this many days. */
    refreshDays: num('OFF_REFRESH_DAYS', 30),
    /** The CSV export that `npm run import:off` streams. */
    dumpUrl: str('OFF_DUMP_URL') ?? 'https://static.openfoodfacts.org/data/en.openfoodfacts.org.products.csv.gz',
    /** countries_tags to import from the dump. */
    importCountries: str('OFF_IMPORT_COUNTRIES') ? list('OFF_IMPORT_COUNTRIES') : ['en:netherlands', 'en:belgium'],
  },

  /**
   * Time zone that decides what "a day" is (diary days, day totals, training days). The profile can override it;
   * this is the default. TZ is the standard variable; without it the Netherlands.
   */
  timeZone: validTimeZone(str('TZ')) ?? 'Europe/Amsterdam',
  version: appVersion(),
};

