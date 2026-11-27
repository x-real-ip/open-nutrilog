// Shared types between server and web client.
// Keep this file free of runtime code so both sides can import it as types only.

/** Language of everything the user sees; English by default. */
export type Language = 'en' | 'nl';

export type AuthMode = 'none' | 'password' | 'proxy' | 'oidc';

export interface Profile {
  name: string;
  language: Language;
  /** IANA time zone that decides what "a day" is; empty means the server default (TZ, else Europe/Amsterdam). */
  timeZone: string;
  updatedAt?: string;
}

export interface AppInfo {
  authMode: AuthMode;
  authRequired: boolean;
  authenticated: boolean;
  user: { username: string; email?: string; name?: string } | null;
  oidcProviderName: string;
  version: string;
  /** The profile's language (English until a profile says otherwise). */
  language: Language;
  /** The time zone in use (profile, else the server default). */
  timeZone: string;
  /** Today in that time zone, YYYY-MM-DD. */
  today: string;
}
