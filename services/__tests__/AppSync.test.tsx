// .tsx (not .ts) so this runs under jest.config.app.js: AppSync.ts's default
// SecureStoreTokenStore transitively imports expo-secure-store, which the
// Node-side ts-jest config (jest.config.js) has no transform for. No JSX
// here — the extension is purely a test-runner routing choice.
import { triggerSync } from '../AppSync';
import { SyncStatusObservable } from '../SyncStatusObservable';
import { InMemoryTokenStore } from '../TokenStore';
import { openNodeSqliteDatabase } from '../../db/adapters/NodeSqliteAdapter';
import { runMigrations } from '../../db/schema';
import type { SqliteDatabase } from '../../db/Database';

describe('triggerSync', () => {
  let db: SqliteDatabase;

  beforeEach(async () => {
    db = openNodeSqliteDatabase(':memory:');
    await runMigrations(db);
  });

  afterEach(async () => {
    await db.closeAsync();
  });

  it('reports a distinct "not signed in" error status, without attempting a network call, when no token is stored', async () => {
    const statusObservable = new SyncStatusObservable();
    const tokenStore = new InMemoryTokenStore(); // empty — no ZEPP_APPTOKEN/ZEPP_USERID set

    await triggerSync(db, statusObservable, tokenStore);

    const status = statusObservable.getStatus();
    expect(status).toEqual({
      phase: 'error',
      endpoint: 'auth',
      message: 'not signed in — no credentials in the Keychain yet',
    });
  });

  it('does not throw when no token is stored (fire-and-forget contract)', async () => {
    const statusObservable = new SyncStatusObservable();
    const tokenStore = new InMemoryTokenStore();

    await expect(triggerSync(db, statusObservable, tokenStore)).resolves.toBeUndefined();
  });
});
