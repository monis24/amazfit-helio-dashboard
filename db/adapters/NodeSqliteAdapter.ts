/**
 * NodeSqliteAdapter.ts — better-sqlite3-backed SqliteDatabase, used by Jest
 * tests and the end-to-end dev sync script (scripts/sync-once.ts). Never
 * imported by production RN code — see ExpoSqliteAdapter.ts for that.
 *
 * better-sqlite3 is synchronous; this wraps every call so the async
 * SqliteDatabase interface is satisfied without changing call sites when
 * swapped for the real (async, native) ExpoSqliteAdapter.
 */

import BetterSqlite3 from 'better-sqlite3';
import type { RunResult, SqliteDatabase } from '../Database';

export function openNodeSqliteDatabase(filename: string): SqliteDatabase {
  const db = new BetterSqlite3(filename);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  return {
    async execAsync(sql: string): Promise<void> {
      db.exec(sql);
    },

    async runAsync(sql: string, params: readonly unknown[] = []): Promise<RunResult> {
      const info = db.prepare(sql).run(...params);
      return { lastInsertRowId: Number(info.lastInsertRowid), changes: info.changes };
    },

    async getAllAsync<T>(sql: string, params: readonly unknown[] = []): Promise<T[]> {
      return db.prepare(sql).all(...params) as T[];
    },

    async getFirstAsync<T>(sql: string, params: readonly unknown[] = []): Promise<T | null> {
      const row = db.prepare(sql).get(...params);
      return (row as T | undefined) ?? null;
    },

    async withTransactionAsync(task: () => Promise<void>): Promise<void> {
      // better-sqlite3's db.transaction() wraps a synchronous function; our
      // task is async (it awaits other async-interface calls that are, under
      // this adapter, synchronous under the hood), so drive it manually with
      // explicit BEGIN/COMMIT/ROLLBACK rather than db.transaction(), which
      // cannot wrap a function returning a Promise.
      db.exec('BEGIN');
      try {
        await task();
        db.exec('COMMIT');
      } catch (err) {
        db.exec('ROLLBACK');
        throw err;
      }
    },

    async closeAsync(): Promise<void> {
      db.close();
    },
  };
}
