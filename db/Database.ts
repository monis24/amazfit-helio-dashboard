/**
 * Database.ts — the storage interface /db's query layer and Phase 1's sync
 * orchestration are written against, matching expo-sqlite's real async API
 * shape (execAsync/runAsync/getAllAsync/getFirstAsync/withTransactionAsync)
 * so the production adapter is a near-zero-wrapper pass-through.
 *
 * Why an interface at all, rather than importing expo-sqlite directly: there
 * is no iOS/Android simulator in this development environment, so the only
 * way to actually run and verify Phase 1's sync/persistence logic is under
 * Node (Jest, and the end-to-end dev sync script). Injecting the storage
 * engine — the same pattern HuamiAuth.ts already uses for its HTTP transport
 * — means the identical query-layer code runs against NodeSqliteAdapter here
 * and now, and against ExpoSqliteAdapter unmodified once this drops into the
 * real Expo app. This is not speculative: both adapters are needed today.
 */

export interface RunResult {
  readonly lastInsertRowId: number;
  readonly changes: number;
}

export interface SqliteDatabase {
  /** Execute one or more statements with no return value and no bound params (DDL, PRAGMA). */
  execAsync(sql: string): Promise<void>;
  /** Execute one statement with bound params; returns rowid/changes, not rows. */
  runAsync(sql: string, params?: readonly unknown[]): Promise<RunResult>;
  /** Query returning zero or more rows. */
  getAllAsync<T>(sql: string, params?: readonly unknown[]): Promise<T[]>;
  /** Query returning at most one row, or null. */
  getFirstAsync<T>(sql: string, params?: readonly unknown[]): Promise<T | null>;
  /** Runs `task` such that all writes inside it commit or roll back together. */
  withTransactionAsync(task: () => Promise<void>): Promise<void>;
  /** Releases underlying resources (file handle / connection). */
  closeAsync(): Promise<void>;
}
