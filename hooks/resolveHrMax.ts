/**
 * resolveHrMax.ts — fetch the synced profile and compute HR_max (Gellish
 * formula) from it. Factored out once this became the third hook doing the
 * exact same three lines (useInsights.ts's Model A path, useCadencePanel.ts,
 * and now useVitalsPanel's HR-zone coloring) — Rule of Three, not a
 * speculative abstraction.
 */

import { ageFromBirthday } from '../types/ZeppApiSchemas';
import { gellishHrMax, type EngineResult } from '../engines/BiometricEngine';
import { getSingletonUserProfile } from '../db/queries/userProfile';
import type { SqliteDatabase } from '../db/Database';

export async function resolveHrMax(db: SqliteDatabase): Promise<EngineResult<number>> {
  const profile = await getSingletonUserProfile(db);
  if (profile === null) {
    return { kind: 'insufficient-data', reason: 'no user profile synced yet (age is required for HR_max)' };
  }
  return { kind: 'ok', value: gellishHrMax(ageFromBirthday(profile.birthday)) };
}
