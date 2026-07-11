/**
 * TokenStore.ts — injectable key-value store for auth tokens, matching
 * expo-secure-store's real API shape (getItemAsync/setItemAsync) closely
 * enough that the production adapter is a thin pass-through — same pattern
 * as Database.ts for SQLite. Three concrete implementations:
 *   - InMemoryTokenStore: Jest tests.
 *   - EnvFileTokenStore: the Phase 0/1 Node dev scripts, persisting into
 *     .env alongside the ZEPP_APPTOKEN/ZEPP_USERID already there.
 *   - SecureStoreTokenStore (adapters/SecureStoreTokenStore.ts): production,
 *     backed by the real expo-secure-store (iOS Keychain).
 */

export const TOKEN_KEYS = {
  appToken: 'ZEPP_APPTOKEN',
  loginToken: 'ZEPP_LOGIN_TOKEN',
  countryCode: 'ZEPP_COUNTRY_CODE',
} as const;

export interface TokenStore {
  getItem(key: string): Promise<string | undefined>;
  setItem(key: string, value: string): Promise<void>;
}

export class InMemoryTokenStore implements TokenStore {
  private readonly values = new Map<string, string>();

  async getItem(key: string): Promise<string | undefined> {
    return this.values.get(key);
  }

  async setItem(key: string, value: string): Promise<void> {
    this.values.set(key, value);
  }
}
