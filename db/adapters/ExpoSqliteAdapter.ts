/**
 * ExpoSqliteAdapter.ts — production SqliteDatabase, backed by the real
 * `expo-sqlite` module. Thin pass-through: expo-sqlite's async API
 * (execAsync/runAsync/getAllAsync/getFirstAsync/withTransactionAsync/
 * closeAsync) already matches the SqliteDatabase interface almost exactly,
 * which is why that interface was shaped this way in the first place.
 *
 * Not exercised in this environment (no iOS/Android simulator available) —
 * NodeSqliteAdapter is what Jest and the dev sync script use instead. This
 * file's job is to be correct against the real expo-sqlite types so dropping
 * it into the actual app requires no changes.
 */

import * as SQLite from 'expo-sqlite';
import type { SQLiteBindParams } from 'expo-sqlite';
import type { RunResult, SqliteDatabase } from '../Database';

/**
 * SqliteDatabase's `params: readonly unknown[]` is intentionally storage-
 * engine-agnostic (better-sqlite3 and expo-sqlite accept overlapping but not
 * identical bind-value types). Callers only ever pass the value types both
 * engines actually accept (string | number | null | Uint8Array); this cast is
 * the interface-boundary seam, not a claim that arbitrary unknowns are valid.
 */
function asBindParams(params: readonly unknown[]): SQLiteBindParams {
  return params as unknown as SQLiteBindParams;
}

export async function openExpoSqliteDatabase(databaseName: string): Promise<SqliteDatabase> {
  const db = await SQLite.openDatabaseAsync(databaseName);

  return {
    execAsync: (sql: string) => db.execAsync(sql),

    runAsync: async (sql: string, params: readonly unknown[] = []): Promise<RunResult> => {
      const result = await db.runAsync(sql, asBindParams(params));
      return { lastInsertRowId: result.lastInsertRowId, changes: result.changes };
    },

    getAllAsync: <T>(sql: string, params: readonly unknown[] = []) =>
      db.getAllAsync<T>(sql, asBindParams(params)),

    getFirstAsync: <T>(sql: string, params: readonly unknown[] = []) =>
      db.getFirstAsync<T>(sql, asBindParams(params)),

    withTransactionAsync: (task: () => Promise<void>) => db.withTransactionAsync(task),

    closeAsync: () => db.closeAsync(),
  };
}
