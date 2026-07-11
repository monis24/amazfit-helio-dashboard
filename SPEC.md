# Amazfit Helio Dashboard — Technical Specification

Build order and model routing are governed by `CLAUDE.md`. This file is the
technical content: what each phase must produce, exact formulas, and reference
implementations to translate rather than reinvent. Do not attempt all phases at
once — stop after each phase per `CLAUDE.md`.

## Reference implementations (translate, do not reinvent)

- **`argrento/huami-token`** — exact OAuth2 flow to extract `apptoken` and
  userid from Huami account credentials.
- **`rolandsz/Mi-Fit-and-Zepp-workout-exporter`** — REST URLs, parameters, and
  response schemas for epoch-level sleep arrays, minute-by-minute HR chunks,
  and workout streams.
- **GadgetBridge** (`https://codeberg.org/Freeyourgadget/Gadgetbridge`) —
  authoritative reference for field semantics, data resolution, and raw vs.
  pre-processed flags for Huami devices.

## Phase 0 — Schema & Protocol Discovery

**Credentials status:** `apptoken` and `userid` have already been retrieved
and are stored locally in `.env` (`ZEPP_APPTOKEN`, `ZEPP_USERID`, gitignored,
not committed). The discovery script should read these directly rather than
performing a fresh OAuth2 login for the enumeration work itself. The
region-specific host URL has not been confirmed yet — verify it against the
`country_code` in a login response rather than assuming a default host; a
wrong host can return HTTP 200 with empty arrays, indistinguishable from a
field genuinely being absent, which would poison `FIELD_INVENTORY.md`.

- Build the Huami OAuth2 login flow as a standalone module, translated
  directly from `argrento/huami-token` (this is the Phase 0 OAuth checkpoint
  per `CLAUDE.md`). Capture `login_token` in addition to `apptoken`/`userid` —
  it's long-lived and is what allows re-minting `apptoken` later without a
  full password login. Store it alongside the other two in `.env`
  (`ZEPP_LOGIN_TOKEN`). This module is exercised once here to obtain
  `login_token`; Phase 1 imports it into `ZeppApiService.ts` rather than
  re-implementing it.
- Enumerate every accessible cloud API endpoint; fetch a sample payload from
  each; introspect the full returned field set. Include the user-profile
  endpoint (age/birthdate, height, weight) — Model A's `HR_max` formula in
  Phase 2 needs `Age` and no other phase currently sources it. If the profile
  endpoint doesn't expose it, note that in `FIELD_INVENTORY.md` and fall back
  to manual entry (stored in MMKV) for Phase 2/3.
- Generate `/types/ZeppApiSchemas.ts` modeling every discoverable field
  precisely — no `any`, no `unknown` without a type guard.
- Output `FIELD_INVENTORY.md`: endpoint URL, access method, required params,
  response shape, field names, units, data resolution (minute-level /
  epoch-level / daily aggregate), and raw vs. pre-processed flag.
- Present the inventory before proceeding to Phase 1.

## Phase 1 — Cloud API Service (`ZeppApiService.ts`)

- Integrate the OAuth2 login module built in Phase 0 (do not re-translate
  `argrento/huami-token` here); add the `login_token → apptoken` refresh path
  so re-authentication doesn't require a full password login. Validate
  response bodies, not just HTTP status — some endpoints return 200 with an
  error payload (e.g. an expired token).
- Ingest every field the API exposes; store full raw payloads — discard
  nothing.
- Prioritize raw, unaggregated time-series: minute-by-minute HR, epoch-level
  sleep stage arrays, step-cadence streams, IBI/HRV records, stress records,
  SpO2, workout GPS/speed streams.
- Persist all data to SQLite with conflict resolution (last-write-wins per
  timestamp key) and sync status tracking.
- Retry with exponential backoff on all network failures.
- Expose sync progress as a reactive state observable the UI can subscribe to.

## Phase 2 — `BiometricEngine.ts`

Self-contained TypeScript utility class reading from the local database. Every
computation is a pure function with typed inputs/outputs, covered by Jest unit
tests (math + edge cases).

**VO2 Max — Model A (Resting Baseline)**
- Parse overnight HR array; find lowest 5-minute rolling average in the final
  120 minutes of sleep → `HR_rest`.
- Gellish max HR: `HR_max = 207 - (0.7 * Age)`. `Age` comes from the Phase 0
  user-profile field if available, else manual entry (MMKV) per Phase 0.
- Uth-Sørensen-Pedersen: `VO2_max = 15.3 * (HR_max / HR_rest)`.

**VO2 Max — Model B (Submaximal Linear Regression)**
- Correlate workout HR stream with CoreLocation speed (`v` in m/min).
- Filter for a 3-minute steady-state window where velocity and HR each deviate
  less than 3% and HR sits between 65%–85% of `HR_max`.
- ACSM metabolic formula: `VO2_cost = (0.2 * v) + 3.5`.
- Extrapolate to max:
  `VO2_max = [(HR_max - HR_rest) / (HR_exercise - HR_rest)] * (VO2_cost - 3.5) + 3.5`.

**Stress (device-computed, not locally computed)**
- No cloud endpoint exposes raw IBI/RR arrays (confirmed against a live
  account during Phase 0 — see `FIELD_INVENTORY.md`), so a locally-computed
  RMSSD is not achievable against this API. Ingest Huami's own proprietary
  stress score instead, from `GET /users/{userid}/events?eventType=all_day_stress`:
  daily min/max/avg (0–100-ish scale, vendor algorithm) plus a ~5-minute-cadence
  `{time, value}` time series. `BiometricEngine.ts` passes this through
  unmodified — there is no local computation step for it, unlike VO2 Max/HRR
  which are genuinely derived on-device. Label it "stress (device-computed)"
  everywhere it's displayed, per Phase 3's local-vs-device distinction rule.

**EPOC & Recovery Windows**
- From post-workout HR streams, calculate Heart Rate Recovery at 1-minute
  (HRR1) and 2-minute (HRR2) intervals.
- Model sympathetic down-regulation slope from recovery curves to estimate
  recovery time remaining.

## Phase 3 — High-Fidelity UI Layer

SwiftUI-inspired layout: clean cards, tight spacing, dark mode by default.
Every chart renders actual raw data from the local database via
`BiometricEngine.ts` — no mock data.

- **Continuous Vitals Panel** — multi-line time-series: minute-by-minute HR
  for the past 24 hours as the primary line; overlaid device-computed stress
  scatter points (labeled as such — see Phase 2) on the same time axis;
  zoomable and pannable.
- **Granular Sleep Hypnogram** — Gantt-style horizontal timeline of exact
  epoch-timestamp state transitions (Deep, Light, REM, Awake); side-by-side
  companion graph of restlessness derived from sleep-stage transition density
  (no cloud endpoint exposes raw accelerometer data — confirmed during the
  post-Phase-0 replanning pass; see that note for whether BLE could expose it
  in the future).
- **Cadence & Efficiency Metrics** — histogram of daily step cadence
  (steps/min, from `stp.stage` activity segments — available every day
  regardless of recorded workouts) bucketed against HR zones for
  cardiovascular economy analysis. Workout streams enrich this when present,
  but are not required — the account had zero recorded workouts at Phase 0
  discovery time.
- **Local Insights Card** — VO2 Max trend (Model A and Model B, labeled
  separately), device-computed stress 7-day trend (labeled as device-computed,
  not local), estimated recovery time remaining. Clearly distinguish locally
  computed values from any device- or cloud-reported values.
- Scaffold data-connected stub panels for any other high-value fields
  discovered in Phase 0 (SpO2 trends, training load) pending scope
  confirmation.

**Future option, documented not implemented — BLE restlessness upgrade.** This
project is cloud-REST-only; BLE ingestion is explicitly out of scope (see
CLAUDE.md's rejection of a speculative `IBiometricProvider` abstraction). For
future reference only, researched against GadgetBridge (the actively
maintained open-source Huami/Zepp BLE integration):

- Historical BLE activity-fetch (not just live-streaming) includes a
  per-minute "intensity" byte alongside the device's own sleep-stage flag —
  semi-raw, firmware-derived motion intensity, not the same as raw
  accelerometer samples, but a genuinely finer-grained restlessness signal
  than the transition-density proxy above. Retrievable for already-elapsed
  time ranges. (Gadgetbridge issue #686, Activity-Analysis wiki.)
- True raw accelerometer streaming exists in Gadgetbridge only as an
  experimental live/real-time mode (PR #894) — it requires the phone to stay
  BLE-connected continuously, with real iOS background-BLE and battery
  costs. Not viable for a background-sync app.
- Uncertain for this specific device: Zepp OS (the Helio's likely firmware
  generation) encrypts BLE communication and requires extracting a
  device-specific auth key; whether the per-minute intensity byte survives
  unchanged in that protocol is not confirmed (Gadgetbridge Zepp-OS wiki,
  issue #5127).
- Practically, this would be a second, structurally separate ingestion path
  (its own BLE pairing/auth-key flow and sync state machine) alongside
  `ZeppApiService.ts`, not an extension of it — a real scope decision if ever
  pursued, not a drop-in addition.

## Phase 4 — Delivery

- Fully functional offline after first sync; no biometric data transmitted
  post-setup.
- `README.md` documenting: OAuth2 setup (referencing `argrento/huami-token`),
  cloud API sync flow, local DB schema, full field inventory summary, and how
  to run the project from scratch.
- Strict TypeScript throughout: full error handling, retry logic, zero `any`,
  zero unimplemented TODOs.
