# Amazfit Helio Dashboard

Offline-first iOS fitness dashboard for the Amazfit Helio Strap. Cloud-first ingestion
via the Zepp/Huami API, persisted to local SQLite, all computation on-device. No
biometric data leaves the phone after initial sync.

## Stack

- Expo (bare workflow), TypeScript strict mode — no `any`
- Expo SQLite for persistence (built — `db/adapters/ExpoSqliteAdapter.ts`)
- Auth tokens specifically use `expo-secure-store` (Keychain-backed, built —
  `services/TokenStore.ts`), not MMKV — a correctness call from the Phase 0
  OAuth checkpoint, not an oversight. MMKV is for other lightweight UI-level
  key-value state Phase 3 introduces (not yet used — nothing needs it yet).
- Victory Native (XL, `victory-native` npm package, Skia-based) for charting
  — chosen over react-native-wagmi-charts during Phase 3: Victory Native
  exposes low-level `@shopify/react-native-skia` canvas primitives (Group/
  Rect/Path via CartesianChart render props), which the Gantt-style Sleep
  Hypnogram needs for custom stage-segment rectangles (drawn directly with
  Skia's `Canvas`/`Rect`, not through CartesianChart — see
  `components/HypnogramPanel.tsx`). wagmi-charts is a fixed set of finance-
  oriented chart types (Line/Candlestick/Bar) with no equivalent custom-mark
  escape hatch. The Continuous Vitals line+scatter chart and Cadence
  histogram use Victory Native's `CartesianChart`/`Line`/`Scatter`/`Bar`
  directly.
- Jest for unit tests: Node-side `ts-jest` (`jest.config.js`, /services
  /engines /db /types /scripts) plus a separate `jest-expo` config
  (`jest.config.app.js`) for RN component/hook tests under /screens
  /components /hooks. `npm test` runs both. `jest.setup.app.js` mocks
  `react-native-safe-area-context`, `@shopify/react-native-skia`, and
  `victory-native` for the app-side suite — real pixel rendering isn't
  something Jest exercises (needs canvaskit-wasm + a custom test
  environment for that); chart rendering is verified on a simulator/device
  instead.

## Structure

Built (Phases 0-3):

```
/services   — cloud API ingestion, OAuth2 (ZeppApiService.ts)
/engines    — local biometric computation (BiometricEngine.ts, plus Phase 3's
              StressTrendEngine.ts / RestlessnessEngine.ts / CadenceEngine.ts)
/db         — SQLite schema, query layer, and mappers (dayAnchor.ts,
              hrBlobMapper.ts, sleepStageMapper.ts)
/types      — strict TypeScript interfaces for all data schemas
/scripts    — one-off Node/TS scripts, not part of the app bundle (Phase 0 discovery)
/hooks      — orchestration: read /db, call /engines, expose view models to /screens.
              This is where impurity (DB reads, memoization) lives so /engines stays
              100% pure — screens never touch /db or /engines directly.
              DatabaseContext.tsx opens the on-device SQLite DB once at app
              startup and hands it to every other hook via context.
/components — reusable UI components (Card, StateMessage, theme.ts, and the
              four Phase 3 panels: VitalsPanel, HypnogramPanel, CadencePanel,
              InsightsPanel)
/screens    — DashboardScreen.tsx: single scrollable screen composing the
              four panels as cards (SwiftUI-inspired dashboard, not a
              multi-screen nav stack — SPEC.md's Phase 3 section describes
              one dashboard view, not separate screens per panel)
```

The Expo app shell now exists: `App.tsx`/`index.ts` entry point, `app.json`,
`babel.config.js`, `metro.config.js`, `react`/`react-native`/`expo` as direct
deps, `tsconfig.json` extended with `jsx` + the app dirs. `ios/`/`android/`
are Expo continuous-native-generation output (`npx expo prebuild`, gitignored
— fully regenerable, never hand-edited; see `.gitignore`'s comment). Building
this required a newer Node than the Phase 0-2 dev environment had — see
`.nvmrc` (24.18.0) — and, for an actual simulator run, Xcode 26 + CocoaPods
(neither was present at the start of Phase 3; installing CocoaPods needs
`sudo xcodebuild -license` accepted first, an interactive step).

## Architecture notes

- **No `IBiometricProvider` abstraction.** Considered and rejected: a
  provider-interface over `CloudZeppProvider`, anticipating a future
  `BleZeppProvider`. Rejected as premature — only one real ingestion path
  exists (cloud REST), no BLE work is planned, and the abstraction would
  have shaped the SQLite schema around a hypothetical raw-binary-packet
  case that doesn't exist. Revisit only if BLE ingestion becomes actual
  scope, not hypothetical — see SPEC.md's Phase 3 BLE research note for
  what that would actually require (a structurally separate ingestion path
  with its own pairing/auth-key flow, not a drop-in second provider).

- **No in-app OAuth login screen (still).** `services/AppSync.ts` (Phase 3's
  in-app sync trigger, added after the After-Phase-3 Fable checkpoint flagged
  that nothing previously called `ZeppApiService.syncAll()` from the app)
  handles a missing token as a distinct, non-crashing 'not signed in' status
  — it does not, and was not asked to, solve how `ZEPP_APPTOKEN`/
  `ZEPP_USERID` get into the device's Keychain in the first place. That
  still requires either a login UI (a real, currently-unscoped feature —
  Phase 0's OAuth module was deliberately never wired to an in-app redirect
  flow) or some other one-time bootstrap. Read `AppSync.ts`'s own doc
  comment before assuming this gap is closed.

- **SpO2 stub panel: deferred, not built.** SPEC.md's Phase 3 section asks
  to "scaffold data-connected stub panels for any other high-value fields
  ... (SpO2 trends, training load) pending scope confirmation." SpO2 is
  ingested (`db/queries/events.ts`'s `spo2_events`/`upsertSpo2Event`, Phase
  1) but Phase 3 built only the four named panels (Vitals, Hypnogram,
  Cadence, Insights) and did not add a fifth. Explicitly deferred, not
  missed — revisit as a scoped decision before Phase 4 sign-off, not a
  silent gap.

- **Dashboard time windows are fixed at mount, not live.** `VitalsPanel`'s
  24h window and `CadencePanel`/`HypnogramPanel`'s "today" are computed once
  per screen mount (`useMemo`/`useState` with no dependency that changes
  over time) — there's no pull-to-refresh or midnight rollover handling. An
  app left open across midnight keeps showing the window from when it
  opened. Acceptable for now; a cheap fix (pull-to-refresh, or a periodic
  re-mount) is real Phase 4 scope, not a bug to chase down now.

## Phases

- **Phase 0** — Protocol discovery: OAuth2 service, discovery script, real
  `FIELD_INVENTORY.md` from a live account.
- **Phase 1** — `ZeppApiService.ts` + SQLite persistence: sync, retry/backoff,
  conflict resolution, sync-status observable.
- **Phase 2** — `BiometricEngine.ts`: VO2 Max (Model A + B), HRR/EPOC, with
  Jest coverage. (No local RMSSD — Phase 0 found no raw-IBI endpoint; stress
  is a device-computed passthrough. See SPEC.md Phase 2.)
- **Phase 3** — UI layer: Continuous Vitals, Sleep Hypnogram, Cadence/Efficiency,
  Insights card. Built and verified end-to-end on an iOS simulator (real
  charts rendering off synthetic data, not just Jest); After-Phase-3 Fable 5
  checkpoint per Model routing below still pending.
- **Phase 4** — Delivery: README, offline verification, final review.

Do not start a phase until the prior one is reviewed (see Model routing below).

## Model routing

Default: Sonnet 5 implements everything within a phase — scaffolding, the DB
layer, UI, tests, docs. This is the bulk of the work and should be done directly,
not escalated.

Fable 5 checkpoints — invoked via the Agent tool with `model: fable`, effort
`high` (not `max`, unless a specific checkpoint proves `high` insufficient — do
not default to max effort as standing policy):

- **Before Phase 0 (now):** planning pass over the full spec — confirm phase
  sequencing, module boundaries, the OAuth approach, and flag risks (e.g.
  whether Model B's steady-state HR/speed correlation is viable given what the
  Helio likely reports for workout streams).
- **During Phase 0:** the OAuth2 translation itself — one careful pass
  translating `argrento/huami-token`'s flow, since a subtle error here fails
  silently rather than loudly. Scope: a standalone login module that captures
  `login_token` (long-lived) in addition to `apptoken`/`userid` — `login_token`
  is what lets a future `apptoken` be re-minted without a full password login.
  Phase 1 imports this module into `ZeppApiService.ts` rather than
  re-translating it.
- **After Phase 0**, once the real field inventory is in hand: a replanning
  pass — design the SQLite schema and the `/engines` ↔ `/screens` interface
  contracts against actual returned fields, not assumptions, and re-check the
  Phase 0 planning assumptions against what the device actually exposes.
- **During Phase 2:** formula derivation/review for VO2 Max (Model A + B) and
  HRR/EPOC — derived independently from the spec, then checked against the
  implementation. Tests alone won't catch a wrong constant if the same
  mistake is baked into both. (RMSSD dropped from this scope — Phase 0 found
  no raw-IBI endpoint; stress is now a device-computed passthrough, no local
  formula to derive. See SPEC.md Phase 2.)
- **After Phase 1, Phase 2, and Phase 3 each complete:** a review pass before
  moving to the next phase — confirm the phase matches the current plan and
  catch integration drift early rather than only at final sign-off. Done for
  Phase 1 and Phase 2 (Phase 2's is separate from the During-Phase-2 formula
  checkpoint above — that one only checks VO2 Max/HRR math, this one checks
  the phase against the plan more broadly). Still pending for Phase 3.
- **Before Phase 4 delivery:** end-to-end review of the full codebase.

**Known risk:** the OAuth checkpoint touches auth-token extraction from a
third-party API — cyber-adjacent content that can trigger Fable 5's safety
classifiers even though the work is legitimate (own account, own data, same
pattern as Gadgetbridge). If a Fable 5 call refuses here, fall back to
**Opus 4.8** for that specific piece, not Sonnet 5 — Opus 4.8 is the closest
capability tier to Fable 5, so a correctness-critical piece like auth loses
less quality on the fallback. This escalation happens explicitly (spawn an
Agent with `model: opus`); do not assume it happens automatically.

Do not route tasks to Opus models except as the named OAuth-checkpoint refusal
fallback above.

## Git workflow

Repo: github.com/monis24/amazfit-helio-dashboard (public).

- Commit and push before each phase's Fable 5 checkpoint runs — a clean,
  pushed snapshot of exactly what's being reviewed.
- If Fable recommends fixes, implement them, then commit and push again.

## Build & test

- Test: `npm test` runs both `npx jest` (Node-side) and
  `npx jest --config jest.config.app.js` (RN component/hook tests). Run just
  one directly with either command.
- Lint: `npx eslint .` (or `npm run lint`) — ESLint 9 + typescript-eslint,
  flat config in `eslint.config.js`. Pinned to ESLint 9, not 10: ESLint 10
  requires a newer Node than the Phase 0-2 dev environment had and crashes
  formatting any actual output (works fine, silently, only when there's
  nothing to report — a real trap if the version drifts back up). Phase 3's
  Node bump (`.nvmrc`, 24.18.0) likely lifts this constraint but it hasn't
  been re-tested against ESLint 10 — don't drift the version without
  checking.
- Type-check: `npx tsc --noEmit` (or `npm run typecheck`)
- Dev server: `npx expo start` (or `npm start`) — real now; requires the
  Node version in `.nvmrc`. `npx expo run:ios` builds and launches on a
  simulator (needs Xcode + CocoaPods — see Structure above).

## Style

- Strict TypeScript throughout — no `any`, no unimplemented TODOs in delivered code
- `/engines` functions are pure, with typed inputs/outputs — required for Jest
  coverage of the math
- Comments explain *why*, not *what* — skip anything a well-named function already
  makes obvious
