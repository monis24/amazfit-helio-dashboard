/**
 * EnvFileTokenStore.ts — Node-only TokenStore backed by the project's .env
 * file, used by Phase 0/1 dev scripts (scripts/discover.ts, scripts/sync-once.ts).
 * Never imported by production RN code — see SecureStoreTokenStore.ts for that.
 *
 * Rewrites the whole file preserving existing keys/comments/ordering as much
 * as reasonably possible; this is a dev convenience, not a general .env
 * parser/writer library.
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import type { TokenStore } from '../TokenStore';

export class EnvFileTokenStore implements TokenStore {
  constructor(private readonly path: string) {}

  async getItem(key: string): Promise<string | undefined> {
    const lines = this.readLines();
    for (const line of lines) {
      const parsed = parseLine(line);
      if (parsed?.key === key) return parsed.value;
    }
    return undefined;
  }

  async setItem(key: string, value: string): Promise<void> {
    const lines = this.readLines();
    let found = false;
    const updated = lines.map((line) => {
      const parsed = parseLine(line);
      if (parsed?.key === key) {
        found = true;
        return `${key}=${value}`;
      }
      return line;
    });
    if (!found) updated.push(`${key}=${value}`);
    writeFileSync(this.path, updated.join('\n').replace(/\n*$/, '\n'), 'utf-8');
  }

  private readLines(): string[] {
    if (!existsSync(this.path)) return [];
    return readFileSync(this.path, 'utf-8').split('\n');
  }
}

function parseLine(line: string): { key: string; value: string } | undefined {
  const trimmed = line.trim();
  if (trimmed.length === 0 || trimmed.startsWith('#')) return undefined;
  const eq = trimmed.indexOf('=');
  if (eq < 0) return undefined;
  return { key: trimmed.slice(0, eq).trim(), value: trimmed.slice(eq + 1).trim() };
}
