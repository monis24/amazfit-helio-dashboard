/**
 * SecureStoreTokenStore.ts — production TokenStore, backed by the real
 * `expo-secure-store` (iOS Keychain). Thin pass-through, same reasoning as
 * ExpoSqliteAdapter.ts. Not exercised in this environment (no simulator).
 */

import * as SecureStore from 'expo-secure-store';
import type { TokenStore } from '../TokenStore';

export class SecureStoreTokenStore implements TokenStore {
  async getItem(key: string): Promise<string | undefined> {
    const value = await SecureStore.getItemAsync(key);
    return value ?? undefined;
  }

  async setItem(key: string, value: string): Promise<void> {
    await SecureStore.setItemAsync(key, value);
  }
}
