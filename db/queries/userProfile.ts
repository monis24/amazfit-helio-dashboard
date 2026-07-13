/**
 * userProfile.ts — singleton profile row. birthday stays "YYYY-MM" as
 * delivered; age is derived at read time (ageFromBirthday), never stored,
 * so it never goes stale.
 */

import type { UserProfile } from '../../types/ZeppApiSchemas';
import type { SqliteDatabase } from '../Database';

export async function upsertUserProfile(db: SqliteDatabase, profile: UserProfile): Promise<void> {
  await db.runAsync(
    `INSERT INTO user_profile (user_id, birthday, gender, height_cm, weight_kg, nick_name, last_update_time)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(user_id) DO UPDATE SET
       birthday = excluded.birthday, gender = excluded.gender, height_cm = excluded.height_cm,
       weight_kg = excluded.weight_kg, nick_name = excluded.nick_name, last_update_time = excluded.last_update_time`,
    [
      profile.userId,
      profile.birthday,
      profile.gender,
      profile.height,
      profile.weight,
      profile.nickName,
      profile.lastUpdateTime,
    ],
  );
}

export interface UserProfileRow {
  readonly user_id: string;
  readonly birthday: string;
  readonly gender: number | null;
  readonly height_cm: number | null;
  readonly weight_kg: number | null;
  readonly nick_name: string | null;
  readonly last_update_time: number | null;
}

export async function getUserProfile(db: SqliteDatabase, userId: string): Promise<UserProfileRow | null> {
  return db.getFirstAsync<UserProfileRow>('SELECT * FROM user_profile WHERE user_id = ?', [userId]);
}

/** user_profile is a singleton table (one row per locally-synced account) —
 *  /hooks don't need to already know the userId just to read it back. */
export async function getSingletonUserProfile(db: SqliteDatabase): Promise<UserProfileRow | null> {
  return db.getFirstAsync<UserProfileRow>('SELECT * FROM user_profile LIMIT 1');
}
