# ADR-005 — Dexie v5 migration for Data Quality (missed & partial fills)

- **Status:** Accepted (architecture sign-off — discharges PREP-6.1)
- **Date:** 2026-07-02
- **Deciders:** Winston (Architect), Csabagura (PO/Project Lead)
- **Supersedes (scoped):** AD-DA-1's "keep Dexie v4 schema, no migration" stance — _only_ for the strictly-additive v5 delta below. The localStorage-vs-Dexie split (AD-8) and repository/`Result<T>` discipline are unchanged.
- **Context source:** Epic 7 (Data Quality), `sprint-change-proposal-2026-06-24.md` Finding C; Story 7.1 (`7-1-missed-and-partial-fill-handling`); carries PREP-4.3 (ServiceReminder distance unit).
- **Related:** `epic-6-retro-2026-07-02.md` §6 (PREP-6.1), `deferred-work.md`.

---

## Context

The full-to-full consumption model (`fuelLogTimeline.ts` → `calculations.ts`) computes against the _immediate predecessor only_ and has no concept of a missed or partial fill, so a forgotten log or a top-up produces a **false-low** consumption reading. Epic 7 fixes this with small **additive** flags on `FuelLog`, keeping absolute odometer as the spine (trip-distance entry was explicitly rejected — same blind spot).

This is the **first Dexie migration since v4** and the first schema change of the UX-upgrade initiative. It touches the calculation spine (AD-DA-3, defined below) and has a **backup/restore `schemaVersion` exact-match implication** that, if unhandled, silently breaks restore of every existing v4 backup. This ADR is the required architecture sign-off before Story 7.1 leaves `ready-for-dev`.

We also fold in **PREP-4.3** (from the Epic 4 retro): `ServiceReminder` carries no stored distance unit, so `currentOdometer` reconciliation blends km/mi. A schema change is already happening here, so this is the right place to add the field (chosen over the omit-on-divergence stopgap).

---

## Decision

Ship a **strictly-additive Dexie v5 migration**. No new tables, no field removals, no type-narrowing, no index changes.

> **Scope note (as shipped in Story 7.1, 2026-07-02).** Story 7.1's task list covers **only** the two `FuelLog` fill-quality flags (`isPartialFill` / `precededByMissedFill`). The **`ServiceReminder.distanceUnit`** field (PREP-4.3) described below is **deferred** — it is not in 7.1's ACs/tasks, so implementing it here would exceed the story's scope. v5 as shipped therefore backfills only the fuel flags. Because migrations are cheaply additive, PREP-4.3 rides a **future additive migration** (v6, or folded into v5 before any broad release) when reminder-unit reconciliation is actually built; it stays tracked in `deferred-work.md`. The `ServiceReminder` schema/backfill sections below are retained as the design of record for that follow-up, not as 7.1 deliverables.

### AD-DA-3 — The calculation spine consumes additive fill-quality flags; DB stays index-stable

The missed/partial concept lives as **non-indexed additive fields** read by the _pure_ timeline builder, never by a Dexie query. The engine's existing `> 0` consumption filter is the drop mechanism for missed intervals. This keeps the query/transaction surface identical to v4 (consistent with the v3 precedent, where `currency` was added without an index).

### 1. Schema deltas (`src/lib/db/schema.ts`)

```ts
interface FuelLog {
	// …existing…
	isPartialFill?: boolean; // v5 — this fill is a top-up; defer calc to the next full fill
	precededByMissedFill?: boolean; // v5 — a fill was missed before this one; interval is unreliable
}

interface ServiceReminder {
	// …existing…
	distanceUnit?: 'km' | 'mi'; // v5 (PREP-4.3) — unit the interval/odometer are expressed in
}
```

All three are **optional** in the type (back-compat, mirroring how `currency?` was added in v3). Optionality is the storage contract; the _runtime_ invariant (booleans are always `true`/`false`) is enforced at the read boundary, below.

### 2. `.stores()` strings — UNCHANGED

None of the three fields is indexed (Story 7.1 filters via the existing in-memory `> 0` analytics filter and reconciles reminder units at read time — neither needs a DB query). Per the "only indexed fields go in the schema string" rule, the v5 `.stores({...})` block **re-declares the v4 strings verbatim**. The version bump + `.upgrade()` is what registers v5.

### 3. Upgrade function (`src/lib/db/migrations/v5.ts` → `migrateV4ToV5`)

Idempotent, mirroring `migrateV2ToV3`'s `.toCollection().modify(...)` pattern:

- **`fuelLogs`:** backfill `isPartialFill = false` and `precededByMissedFill = false` on any row where the field is `null`/`undefined`. These are the lossless historical values (every existing row _was_ a full, non-missed fill). Backfilling makes the stored data self-describing and idempotent (re-run = no-op).
- **`serviceReminders`:** backfill `distanceUnit` from the vehicle's **most-recent `FuelLog.distanceUnit`** for that `vehicleId` (the same "derive unit from existing data" approach v2 used to backfill `FuelLog.distanceUnit`). If the vehicle has **no** fuel logs, leave `distanceUnit` undefined → the read boundary falls back to the vehicle's current display unit (no guess is written).

Register in `db.ts`:

```ts
this.version(5)
	.stores({
		/* verbatim v4 strings */
	})
	.upgrade(migrateV4ToV5);
```

### 4. Read-boundary normalization (repositories / timeline)

Consumers coerce absent flags to `false` (`log.isPartialFill ?? false`) so a mid-upgrade or imported-older row is always safe even before/without the backfill. This is the belt to the upgrade's braces — the calc must never see `undefined` as truthy/falsy ambiguity.

### 5. Backup/restore — RELAX the exact-match (the critical implication)

`backup.ts:131` currently rejects any non-exact schema: `if (parsed.schemaVersion !== DB_VERSION)`. Once `DB_VERSION → 5`, that **rejects every existing v4 backup** — a silent data-portability regression, and it fails Story 7.1's AC ("backup/restore continues to round-trip across the v4→v5 bump").

**Decision:** change the guard to reject only backups **newer** than the running app, and forward-migrate older ones on import:

- Replace `!==` with `parsed.schemaVersion > DB_VERSION` → reject (a v5 backup on a not-yet-updated v4 app).
- Accept `schemaVersion <= DB_VERSION`; when `< DB_VERSION`, apply the same additive defaults on import (new `FuelLog` booleans → `false`; reminder `distanceUnit` → derive-or-undefined). Because v5 is strictly additive with safe defaults, a v4 backup is trivially forward-compatible.
- Keep the `isValidFuelLog` / `isValidServiceReminder` validators accepting rows **without** the new fields (they are optional). If the validators assert new fields, they must gate on `=== undefined || typeof === 'boolean'` / `'km'|'mi'`.
- Update `BackupData` typing + the revive path to carry the new fields through.

### 6. Importer wiring (`src/lib/utils/importParseFuelly.ts`)

The Fuelly parser **already reads** `missed_fuelup` / `partial_fuelup` (`:101-102`) and currently discards them. Map them into `precededByMissedFill` / `isPartialFill` on the produced `NewFuelLog`. No new parse columns.

### 7. Calc-spine integration (`fuelLogTimeline.ts` + `calculations.ts`)

- **Partial fill:** defers its own calc — distance and litres accumulate forward to the next **full** fill, which computes consumption across the spanning interval (the predecessor lookup must skip over partials when composing the interval).
- **Missed-preceded interval:** compute `calculatedConsumption = 0` so it drops out of trends/stats via the **existing** analytics `> 0` filter — no engine (Hero Metric / Insight / trend) change beyond feeding it the corrected series (no NaN/false-low leak).
- Capture form exposes two unobtrusive, accessible, default-off toggles (a11y floor from Epic 6 applies — computed-style/behavioral test discipline, [[a11y-axe-false-green-trap]]).

### 8. `config.ts`

`DB_VERSION = 4 → 5`. This is the single source the backup `schemaVersion` reuses (comment at `config.ts:47`).

---

## Files in scope (Story 7.1)

`src/lib/config.ts` (DB_VERSION) · `src/lib/db/schema.ts` (3 fields) · `src/lib/db/db.ts` (`.version(5)`) · `src/lib/db/migrations/v5.ts` + `v5.test.ts` (new) · `src/lib/utils/backup.ts` (relax guard + validators + revive) · `src/lib/utils/importParseFuelly.ts` (wire 2 columns) · `src/lib/utils/fuelLogTimeline.ts` + `calculations.ts` (partial-defer / missed-zero) · fuel Capture form (2 toggles) · repository read normalization. Backup round-trip + migration tests co-located.

## Testing mandates

- **`v5.test.ts`:** upgrade backfills both booleans to `false`; reminder `distanceUnit` derived from latest log / undefined when no logs; idempotent re-run is a no-op. Use `fake-indexeddb`.
- **Backup round-trip v4↔v5:** a v4-schema backup restores cleanly on v5 (defaults applied); a v5 backup round-trips; a `schemaVersion > DB_VERSION` backup is rejected with the existing `VALIDATION_ERROR` copy.
- **Calc spine:** partial defers + accumulates to next full; missed-preceded → `0` and is absent from trend/Insight/Hero; no NaN.
- **Importer:** Fuelly rows with `missed_fuelup`/`partial_fuelup` set land the flags.
- Standing gates: `check`/`lint`/`test`/`test:a11y`; **`test:artifacts` ≤ 255 KB** (PREP-6.2 — measure per-PR, raise only on real breach; not expected — logic + migration, not payload); CSP `connect-src 'none'` byte-unchanged (NFR-1).

## Fences (hard)

- **Strictly additive only** — no table add/drop, no field removal/rename, no index change, no type-narrowing of existing fields.
- **No network / CSP / service-worker / privacy-contract change.** Migration + backup run fully offline.
- **localStorage-vs-Dexie split (AD-8) unchanged** — reminder-dismissal etc. stay in localStorage; only the three domain fields land in Dexie.
- **Repository + `Result<T>` discipline** — all mutations through repositories; Dexie stays isolated to `src/lib/db/**`.

## Consequences

**Positive:** consumption stops reading false-low on imperfect logs; reminder unit reconciliation becomes deterministic (PREP-4.3 closed); v4 backups remain restorable _and_ the format gains forward-compat headroom for future additive bumps; the migration ladder (v1→v5) stays clean and idempotent.

**Negative / risk:** the backup guard relaxation is the highest-risk edit — a wrong comparator direction would either reject valid backups or accept future-incompatible ones; it is explicitly test-gated above. The calc-spine partial-accumulation logic is the subtlest correctness surface (predecessor-skipping) and carries the bulk of the story's unit tests.

**Decision:** **Accepted.** Story 7.1 is cleared to leave `ready-for-dev` on this sign-off. Standing gates (AI-1 ship-gate, AI-2 claim-accuracy, independent 3-layer review — AI-6.1) apply; a migration is exactly the kind of "small" story the review-uniformity discipline must not skip.
