/**
 * DatabaseContext.tsx — opens the on-device SQLite database once at app
 * startup and hands the resulting SqliteDatabase to every other hook via
 * context. This is the one piece of /hooks that's about connection
 * lifecycle rather than a specific panel's view model — CLAUDE.md's
 * Structure section describes /hooks as "where impurity... lives," and
 * opening a database handle is the impurity every other hook in this
 * directory depends on.
 *
 * DatabaseProvider only renders its children once the database is open and
 * migrated — every other hook in /hooks can therefore assume useDatabase()
 * always returns a ready SqliteDatabase, never undefined, and never has to
 * carry its own "is the DB even open yet" state.
 */

import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { Text, View } from 'react-native';

import { openExpoSqliteDatabase } from '../db/adapters/ExpoSqliteAdapter';
import { runMigrations } from '../db/schema';
import type { SqliteDatabase } from '../db/Database';
import { colors, spacing } from '../components/theme';

const DEFAULT_DATABASE_NAME = 'amazfit-helio.db';

/** Exported (not just useDatabase/DatabaseProvider) so tests can inject a
 *  NodeSqliteAdapter directly via `<DatabaseReactContext.Provider>`,
 *  bypassing DatabaseProvider's real expo-sqlite open (unavailable under
 *  Jest — see db/adapters/ExpoSqliteAdapter.ts's own doc comment). */
export const DatabaseReactContext = createContext<SqliteDatabase | undefined>(undefined);

export interface DatabaseProviderProps {
  readonly databaseName?: string;
  readonly children: ReactNode;
}

type ProviderState =
  | { readonly status: 'loading' }
  | { readonly status: 'ready'; readonly db: SqliteDatabase }
  | { readonly status: 'error'; readonly message: string };

export function DatabaseProvider({ databaseName = DEFAULT_DATABASE_NAME, children }: DatabaseProviderProps): React.JSX.Element {
  const [state, setState] = useState<ProviderState>({ status: 'loading' });

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const db = await openExpoSqliteDatabase(databaseName);
        await runMigrations(db);
        if (!cancelled) setState({ status: 'ready', db });
      } catch (err) {
        if (!cancelled) setState({ status: 'error', message: err instanceof Error ? err.message : String(err) });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [databaseName]);

  if (state.status === 'loading') {
    return (
      <View style={{ flex: 1, backgroundColor: colors.background, alignItems: 'center', justifyContent: 'center' }}>
        <Text style={{ color: colors.textSecondary }}>Opening database…</Text>
      </View>
    );
  }

  if (state.status === 'error') {
    return (
      <View style={{ flex: 1, backgroundColor: colors.background, alignItems: 'center', justifyContent: 'center', padding: spacing.lg }}>
        <Text style={{ color: colors.negative, textAlign: 'center' }}>Failed to open the local database: {state.message}</Text>
      </View>
    );
  }

  return <DatabaseReactContext.Provider value={state.db}>{children}</DatabaseReactContext.Provider>;
}

/** Throws outside a DatabaseProvider — a real programmer error, not a
 *  fallible state screens should render around. */
export function useDatabase(): SqliteDatabase {
  const db = useContext(DatabaseReactContext);
  if (db === undefined) {
    throw new Error('useDatabase() called outside a <DatabaseProvider>');
  }
  return db;
}
