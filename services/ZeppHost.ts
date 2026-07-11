/**
 * ZeppHost.ts — regional API host auto-detection, shared by scripts/discover.ts
 * (Phase 0) and ZeppApiService.ts (Phase 1) so this critical, silent-failure-
 * prone logic has exactly one implementation. See FIELD_INVENTORY.md: a
 * wrong host can return HTTP 200 with an empty array rather than an error,
 * indistinguishable from "the account genuinely has no data" — the devices
 * list is used as the detection canary because a real account's non-empty
 * device list is much stronger evidence than a bare 200.
 */

export interface FetchLike {
  (url: string, init: { method: 'GET'; headers: Record<string, string> }): Promise<{
    status: number;
    text(): Promise<string>;
  }>;
}

// Ordered by likelihood per checkpoint-0 research: current zepp.com rebrand
// first, legacy huami.com as fallback; us2 default, de2 and no-suffix next.
// sg2/in2/ru2 omitted — unconfirmed by any reference source.
export const CANDIDATE_HOSTS: readonly string[] = [
  'https://api-mifit-us2.zepp.com',
  'https://api-mifit-us2.huami.com',
  'https://api-mifit-de2.zepp.com',
  'https://api-mifit-de2.huami.com',
  'https://api-mifit.zepp.com',
  'https://api-mifit.huami.com',
];

export interface HostProbeAttempt {
  readonly host: string;
  readonly status: number | 'network-error';
  readonly deviceCount: number | undefined;
  readonly error: string | undefined;
}

export interface HostDetectionResult {
  readonly host: string;
  readonly attempts: readonly HostProbeAttempt[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function extractDeviceArray(json: Record<string, unknown>): unknown[] | undefined {
  for (const key of ['items', 'devices', 'data']) {
    const value = json[key];
    if (Array.isArray(value)) return value;
  }
  return undefined;
}

export interface DetectApiHostOptions {
  readonly candidateHosts?: readonly string[];
  readonly extraHeaders?: Record<string, string>;
}

export async function detectApiHost(
  fetchImpl: FetchLike,
  appToken: string,
  userId: string,
  options: DetectApiHostOptions = {},
): Promise<HostDetectionResult> {
  const attempts: HostProbeAttempt[] = [];
  const headers = { apptoken: appToken, ...options.extraHeaders };

  for (const host of options.candidateHosts ?? CANDIDATE_HOSTS) {
    const url = `${host}/users/${encodeURIComponent(userId)}/devices`;
    let status: number | 'network-error' = 'network-error';
    let json: unknown;
    let error: string | undefined;

    try {
      const response = await fetchImpl(url, { method: 'GET', headers });
      status = response.status;
      const body = await response.text();
      try {
        json = JSON.parse(body);
      } catch {
        // leave json undefined
      }
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    }

    if (status === 200 && isRecord(json)) {
      const bodyError = readString(json['error']) ?? readString(json['error_code']);
      if (bodyError !== undefined) {
        attempts.push({ host, status, deviceCount: undefined, error: bodyError });
        continue;
      }
      const items = extractDeviceArray(json);
      attempts.push({ host, status, deviceCount: items?.length, error: undefined });
      if (items !== undefined && items.length > 0) {
        return { host, attempts };
      }
    } else {
      attempts.push({ host, status, deviceCount: undefined, error });
    }
  }

  const fallback = attempts.find((a) => a.status === 200 && a.error === undefined);
  if (fallback !== undefined) {
    return { host: fallback.host, attempts };
  }

  throw new Error(
    `Could not detect a working regional host. Attempts:\n${attempts
      .map((a) => `  ${a.host} -> status=${a.status}${a.error !== undefined ? ` error=${a.error}` : ''}`)
      .join('\n')}`,
  );
}
