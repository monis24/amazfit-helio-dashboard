# Amazfit Helio Dashboard

Offline-first iOS fitness dashboard for the Amazfit Helio Strap. Cloud-first ingestion
via the Zepp/Huami API, persisted to local SQLite, all computation on-device. No
biometric data leaves the phone after initial sync.

## Stack

- Expo (bare workflow), TypeScript strict mode — no `any`
- Expo SQLite for persistence, MMKV for key-value state
- react-native-wagmi-charts / Victory Native for charting
- Jest for unit tests

## Structure

```
/services   — cloud API ingestion, OAuth2 (ZeppApiService.ts)
/engines    — local biometric computation (BiometricEngine.ts)
/screens    — full screen views
/components — reusable UI components
/db         — SQLite schema and query layer
/types      — strict TypeScript interfaces for all data schemas
/scripts    — one-off Node/TS scripts, not part of the app bundle (Phase 0 discovery)
/hooks      — orchestration: read /db, call /engines, expose view models to /screens.
              This is where impurity (DB reads, memoization) lives so /engines stays
              100% pure — screens never touch /db or /engines directly.
```

## Phases

- **Phase 0** — Protocol discovery: OAuth2 service, discovery script, real
  `FIELD_INVENTORY.md` from a live account.
- **Phase 1** — `ZeppApiService.ts` + SQLite persistence: sync, retry/backoff,
  conflict resolution, sync-status observable.
- **Phase 2** — `BiometricEngine.ts`: VO2 Max (Model A + B), HRR/EPOC, with
  Jest coverage. (No local RMSSD — Phase 0 found no raw-IBI endpoint; stress
  is a device-computed passthrough. See SPEC.md Phase 2.)
- **Phase 3** — UI layer: Continuous Vitals, Sleep Hypnogram, Cadence/Efficiency,
  Insights card.
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
  catch integration drift early rather than only at final sign-off.
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

- Test: `npx jest`
- Lint: `npx eslint . --ext .ts,.tsx`
- Type-check: `npx tsc --noEmit`
- Dev server: `npx expo start`

## Style

- Strict TypeScript throughout — no `any`, no unimplemented TODOs in delivered code
- `/engines` functions are pure, with typed inputs/outputs — required for Jest
  coverage of the math
- Comments explain *why*, not *what* — skip anything a well-named function already
  makes obvious
