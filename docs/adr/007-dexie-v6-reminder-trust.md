# ADR-007 — Dexie v6: reminder trust

- **Status:** **Accepted** (architecture sign-off — discharges **PREP-8.2**; hard gate before Story 8.5 dev)
- **Date:** 2026-07-03
- **Deciders:** Winston (Architect), Csabagura (PO/Project Lead)
- **Extends (scoped, strictly additive):** ADR-005's `ServiceReminder.distanceUnit` design-of-record (PREP-4.3, deferred there to "a future additive migration, v6 or folded into v5 before any broad release") is discharged here. No table add/drop, no field removal/rename, no index change, no type-narrowing of existing fields.
- **Context source:** `logic-audit-2026-07-02.md` (H10, H11, H18, S20–S26, S21, S22); `sprint-change-proposal-2026-07-02.md`; Story 8.5 (`epics.md` lines 678–692); ADR-005 §"Scope note" and §3 (`ServiceReminder.distanceUnit` design of record).
- **Related:** ADR-005 (v4→v5 fill-quality flags; carries PREP-4.3), ADR-006 (one write boundary — the repo/validator skeleton this ADR's new field validators plug into), `deferred-work.md`. Baseline verified at `main @ be51780` (post Story 8-4).

---

## Context

`DB_VERSION = 5` (`config.ts:44`). The current `ServiceReminder` interface (`schema.ts:41-51`) is:

```ts
interface ServiceReminder {
	id?: number;
	vehicleId: number;
	title: string;
	intervalKm?: number;
	intervalDays?: number;
	lastServiceOdometer?: number;
	lastServiceDate?: string;
	notes?: string;
}
```

No `createdAt`, `distanceUnit`, or provenance field exists. Three audit findings converge on "the row doesn't know enough about itself to be trusted":

**H10 — dismissal has no concept of _which_ due instance was dismissed.** `reminderDismissal.ts`'s localStorage map is `Record<number, {status: ReminderStatus; odometer?: number}>` — it re-surfaces only when severity worsens or `currentOdometer >= marker.odometer + REMINDER_DUE_SOON_KM` (`:141-147`). There is **no date-based re-surfacing at all** — an expense-only user who dismisses a day-cadence reminder silences it permanently. Editing a reminder's schedule doesn't invalidate a stale dismissal marker either. Pruning is a `UpNextCard.svelte:119-132` `$effect`, scoped to the active vehicle post-8.1 (interim; the component-level scoping was explicitly flagged in that story's comments — `:118` — as "orphans wait for 8-5's due-instance model").

**H11 — absent baseline produces no signal, not a false one, but that's still wrong.** 8.1's interim fix (`serviceReminder.ts:82-85`, comment: _"Honest 'since creation' baselines arrive with `createdAt` in 8-5/ADR-007"_) already stopped `?? 0`-style false "Overdue by 195,000 km" output — an absent `lastServiceOdometer`/`lastServiceDate` today contributes **no signal on that dimension**, which is honest but means a day-only reminder with no `lastServiceDate` is invisible forever, and a km-only reminder with no `lastServiceOdometer` never reads "due." The row has no anchor to count from.

**H18 — loop-close ignores the odometer sitting right there.** `reminderResetOffer.ts:95-111`'s `applyReset()` **always** derives the closing odometer from `currentOdometerFromLogs(logs.data)` (`:100`), never from `expense.odometer` even though `Expense.odometer?: number` already exists (`schema.ts:34`) and is the more precise, event-scoped reading. There is no record of _which_ expense triggered a reset, so a reset cannot be identified as stale or reverted if that expense is later edited or deleted.

**S20–S26 — reminder-adjacent consistency gaps**, none schema-bearing but grounded here because they share this story: two mount-frozen `new Date()` instances (`UpNextCard.svelte:30`, `MaintainDashboard.svelte:32` — Svelte 5 `$props()` defaults evaluate once, not reactively); no tie-break logic between km- and date-based due predictions because no such comparison exists yet (`reminderPrediction.ts` only predicts distance; day-remaining is computed separately in `serviceReminder.ts`); `MAX_PREDICTION_DAYS = 365` (`reminderPrediction.ts:22`) has no explicit tie to cadence's own date handling; `ServiceReminderForm.svelte`'s `validateLastServiceDate()` (`:111-117`) checks only for a malformed string, not a future date; `REMINDER_DUE_SOON_KM = 500` / `REMINDER_DUE_SOON_DAYS = 14` (`config.ts:57-58`) are unit-naive bare constants — no `distanceUnit`-aware conversion exists anywhere near reminders today.

**This is a schema problem as well as a logic problem** (unlike ADR-006). Three of the six domain rules below need a durable, queryable-adjacent fact the row doesn't currently carry: _when was this reminder created_, _what distance unit are its numbers in_, and _what expense last closed it_. All three are additive.

---

## Decision

Ship a **strictly-additive Dexie v6 migration**, extending the v5 pattern verbatim (`db.ts` versions 1–5, v5 at `:66-73`; `.stores()` re-declared unchanged since none of the new fields are indexed).

### AD-RT-1 — Schema deltas (`src/lib/db/schema.ts`)

```ts
interface ServiceReminder {
	// …existing…
	createdAt?: number; // v6 — epoch ms; the anchor of last resort for both dimensions (H11)
	distanceUnit?: 'km' | 'mi'; // v6 (discharges PREP-4.3 per ADR-005 design of record) — unit intervalKm/lastServiceOdometer are expressed in
	lastClosedByExpenseId?: number; // v6 — provenance of the last loop-close reset, for idempotency + revert (H18)
}
```

All three optional (back-compat, mirroring `currency?`/v5's booleans). `.stores()` block re-declares the v5 strings verbatim — none of the three is indexed; `createdAt`/`distanceUnit` are read at render/compute time, not queried, and `lastClosedByExpenseId` is looked up by scanning the vehicle's already-loaded reminder list on expense delete, not by a DB query.

**Scope note:** `lastClosedByExpenseId` was not named in PREP-8.2's stated "createdAt + distanceUnit" scope. It is added here because H18 ("idempotent and revertible with the expense") is unimplementable without recording _which_ expense closed the loop — the field is exactly as additive/low-risk as the other two, and deferring it would either silently drop H18's revert requirement or force a v7 migration one story later for a single boolean-adjacent field. **Owner-confirmed 2026-07-03: include it.**

### AD-RT-2 — Migration (`src/lib/db/migrations/v6.ts` → `migrateV5ToV6`)

Idempotent, mirroring `migrateV4ToV5`:

- **`serviceReminders.createdAt`:** backfill to `lastServiceDate.getTime()` when present (**correction, 8-5 create-story:** `lastServiceDate` is already stored as a `Date`, not a string — `schema.ts:48` — so this is a direct `.getTime()` read, not string parsing) — an existing service record is real historical signal and the honest anchor; otherwise to **migration-time** (`Date.now()`, captured once at upgrade and reused for every row in the batch, not re-read per row). A reminder with no service history starts counting "since creation" from today rather than manufacturing a fictitious past date — consistent with the "no guess is written" principle ADR-005 used for `distanceUnit`'s undefined case, except `createdAt` cannot be left undefined (it is the anchor of last resort — AD-RT-3 depends on it always resolving to _something_).
- **`serviceReminders.distanceUnit`:** unchanged from ADR-005's already-specified design of record — derive from the vehicle's most-recent `FuelLog.distanceUnit`; if the vehicle has no fuel logs, leave undefined (read boundary falls back to the vehicle's current display-unit setting, never a guess).
- **`serviceReminders.lastClosedByExpenseId`:** **not backfilled** — left undefined for every pre-v6 row. No historical loop-close event is reconstructable from existing data; this is forward-looking only.

```ts
this.version(6)
	.stores({
		/* verbatim v5 strings */
	})
	.upgrade(migrateV5ToV6);
```

`config.ts:44` — `DB_VERSION = 5 → 6`. Backup restore's version-range check (`config.ts:46-49`) extends its accepted range to include 6.

### AD-RT-3 — Read-boundary anchor rule: absent baseline resolves to "as of createdAt," not "no signal" (closes H11)

Today, an absent `lastServiceOdometer`/`lastServiceDate` yields no signal on that dimension (8.1's honest interim). v6 replaces "no signal" with **"the value as of `createdAt`"**:

- **Date dimension:** if `lastServiceDate` is absent, the baseline date is `createdAt` (converted to a date). A day-cadence reminder now becomes due `intervalDays` after its creation, not never.
- **Distance dimension:** if `lastServiceOdometer` is absent, the baseline odometer is **the vehicle's odometer interpolated at `createdAt`** — nearest fuel-log odometer at-or-before that timestamp, falling back to the earliest fuel log's odometer if `createdAt` predates all logs, or **no signal** (unchanged from today) if the vehicle has zero fuel logs to interpolate from. This requires a new pure engine helper, `odometerAtDate(fuelLogs, timestamp)` — implemented in Story 8.5, consistent with the existing `currentOdometer(fuelLogs)` family and the "engine-owned, Dexie-isolated" discipline.

This is the one real domain call in this ADR (mirrors ADR-006's AD-WB-5 anchor-trust rule): interpolating a historical odometer is strictly more work and more inference than the alternative of "still show no km signal, only anchor the date dimension." The interpolated-odometer approach is chosen because H11's explicit intent is symmetry ("anchors to `createdAt` on **both** dimensions") — a km-cadence reminder with no service history should behave the same as a day-cadence one, not remain permanently silent on its primary dimension. **Owner-confirmed 2026-07-03: interpolate.**

### AD-RT-4 — Due-instance dismissal model (closes H10, completes 8.1's interim fix)

The localStorage dismissal map (`REMINDER_DISMISSED_STORAGE_KEY`, unchanged — AD-8 split stands, no Dexie involvement) gains the due-instance shape:

```ts
Record<number, { status: ReminderStatus; dueAtOdometer?: number; dueAtDate?: string }>;
```

replacing the current `{status, odometer?}`. A dismissal now records **what threshold it dismissed**, not just a re-surface-distance offset:

- **Expiry is exact:** re-surface fires when `currentOdometer >= marker.dueAtOdometer` (no more `+ REMINDER_DUE_SOON_KM` fuzz — the due-soon window is a _display_ concern, not a dismissal-expiry one) **or** `today >= marker.dueAtDate` — whichever the reminder actually tracks. This closes the "expense-only user, no date signal" gap: a day-cadence reminder now has a `dueAtDate` to expire against regardless of odometer activity.
- **Edit invalidation:** `updateServiceReminder` (repo write path, per ADR-006's write-skeleton) clears any existing dismissal marker for that reminder id when `intervalKm`, `intervalDays`, `lastServiceOdometer`, or `lastServiceDate` changes — a stale dismissal against an old schedule cannot survive an edit.
- **Pruning becomes domain logic in `reminderDismissal.ts`**, not a component `$effect`: a new exported `pruneDismissals(activeReminderIds: number[])` (or vehicle-scoped equivalent) that `UpNextCard.svelte` calls, rather than owning the prune logic itself. This is a **move**, not new logic — 8.1's vehicle-scoping behavior is preserved, just relocated to the layer the audit and the 8.1 story comment both said it belonged.

### AD-RT-5 — Loop-close prefers the expense's own odometer, records provenance (closes H18)

`reminderResetOffer.ts`'s `applyReset()` changes its odometer source order: `expense.odometer` when present and positive, else `currentOdometerFromLogs(logs.data)` (today's sole path, kept as fallback for odometer-less expenses). On write, `lastClosedByExpenseId = expense.id` is stamped alongside the existing `lastServiceDate`/`lastServiceOdometer` updates.

- **Idempotent:** re-applying a reset from the same expense (e.g. a re-triggered effect) writes the same values — a Dexie `put` of identical data, no observable double-effect.
- **Revertible with the expense:** on expense delete, if any reminder's `lastClosedByExpenseId` matches the deleted expense's id, that reminder's `lastServiceDate`, `lastServiceOdometer`, and `lastClosedByExpenseId` are cleared (not restored to an unknowable prior value — reverted to "no baseline," which AD-RT-3 then honestly anchors to `createdAt`). This is the simplest revert that doesn't require storing pre-reset snapshots, and it composes correctly with AD-RT-3 rather than needing its own special case.

### AD-RT-6 — Unit-aware thresholds (closes S22)

`REMINDER_DUE_SOON_KM = 500` gains a sibling `REMINDER_DUE_SOON_MI = 500` (a distinct round number per unit, not a lossy 500 km→311 mi conversion — consistent with how the app already treats display units as first-class rather than derived). The threshold consumed at `serviceReminder.ts:128-129` and `reminderDismissal.ts:144` (post-AD-RT-4 relocation) selects by the reminder's resolved `distanceUnit` (reminder's own field → vehicle's current display unit fallback, same chain as AD-RT-2's backfill). `REMINDER_DUE_SOON_DAYS` is already unit-agnostic and unchanged.

### AD-RT-7 — Reminder-adjacent consistency (closes S20, S21, S23–S26; no schema involvement)

- **S20:** a shared reactive wall-clock utility (`visibilitychange`/`pageshow`-driven `$state<Date>`, or a small store) replaces both `UpNextCard.svelte:30` and `MaintainDashboard.svelte:32`'s mount-frozen `new Date()` prop defaults.
- **S23:** `reminderPrediction.ts` gains an explicit tie-break — when both a km-based and a date-based due prediction exist for the same reminder, the **nearer** one determines the surfaced status (ties broken toward the date prediction, since km-drift interpolation carries more uncertainty than a calendar date).
- **S24/S25:** the date-based due computation applies the same `MAX_PREDICTION_DAYS = 365` ceiling `reminderPrediction.ts:22` already uses for km-based prediction, so neither dimension can predict further out than the other.
- **S26:** `ServiceReminderForm.svelte`'s `validateLastServiceDate()` rejects a future date (past-or-today only), matching the odometer form's existing not-in-the-future discipline elsewhere in the app.
- **S21:** the reminder title token matcher (used wherever reminder titles are fuzzy-matched, e.g. "Log this service" prefill / due-soon grouping) becomes Unicode-aware (`\p{L}`-class tokenization or `Intl.Segmenter`) so Hungarian titles stop fragmenting into cross-matching shards.

---

## Files in scope (Story 8.5)

`src/lib/config.ts` (`DB_VERSION`, `REMINDER_DUE_SOON_MI`) · `src/lib/db/schema.ts` (3 fields) · `src/lib/db/db.ts` (`.version(6)`) · `src/lib/db/migrations/v6.ts` + `v6.test.ts` (new) · `src/lib/utils/reminderDismissal.ts` (due-instance shape + `pruneDismissals` domain function + edit-invalidation hook) · `src/lib/utils/serviceReminder.ts` (`computeReminderStatus` anchor rule, unit-aware threshold) · `src/lib/utils/metrics/reminderPrediction.ts` (tie-break, date ceiling, new `odometerAtDate` helper) · `src/lib/utils/reminderLoopClose.ts` + `reminderResetOffer.ts` (odometer provenance, revert-on-delete) · `src/lib/utils/rowValidation.ts` (validators for the 3 new fields, per ADR-006's shared-validator module) · `src/lib/utils/backup.ts` (revive/normalize new fields, version-range extension) · `ServiceReminderForm.svelte` (past-only date validation) · `UpNextCard.svelte` + `MaintainDashboard.svelte` (reactive wall-clock, relocated prune call).

## Testing mandates

- **`v6.test.ts`:** upgrade backfills `createdAt` correctly from both branches (has-`lastServiceDate` vs. absent → migration-time), idempotent re-run is a no-op; `distanceUnit` backfill unchanged behavior re-verified; `lastClosedByExpenseId` stays undefined post-migration. Use `fake-indexeddb`.
- **Backup round-trip v5↔v6:** a v5-schema backup restores cleanly on v6 (defaults applied to all three new fields); a v6 backup round-trips; a `schemaVersion` beyond `DB_VERSION` is rejected with the existing `VALIDATION_ERROR` copy.
- **Anchor rule (AD-RT-3):** absent-baseline reminder becomes due `intervalDays`/`intervalKm` after `createdAt`, not never; `odometerAtDate` interpolation tested against before/after/exact-match fuel-log fixtures and the zero-fuel-logs no-signal fallback.
- **Dismissal (AD-RT-4):** exact-expiry re-surfacing on both dimensions; edit invalidates a stale marker; prune is exercised as a pure function, not via component mount.
- **Loop-close (AD-RT-5):** expense-odometer preferred when present and positive; falls back correctly when absent/non-positive; idempotent re-apply; revert-on-delete only affects the matching `lastClosedByExpenseId`, never an unrelated reminder closed by a different expense.
- Standing gates: `check`/`lint`/`test`/`test:a11y`; `test:artifacts` ≤ 255 KB (PREP-4.1 — measure per-PR, raise only on real breach); CSP `connect-src 'none'` byte-unchanged (NFR-1).

## Fences (hard)

- **Strictly additive only** — no table add/drop, no field removal/rename, no index change, no type-narrowing of existing fields.
- **No network / CSP / service-worker / privacy-contract change.** Migration + backup run fully offline.
- **localStorage-vs-Dexie split (AD-8) unchanged** — the due-instance dismissal shape lives in localStorage; only the three `ServiceReminder` fields land in Dexie.
- **Repository + `Result<T>` discipline, one write boundary (ADR-006)** — the three new fields' invariants (if any — `createdAt`/`distanceUnit`/`lastClosedByExpenseId` are all simple optional scalars with no cross-field constraint beyond `distanceUnit ∈ {'km','mi'}`) go through the shared row-validator module, not a bespoke check.
- **No stored-span-distance change** — that remains ADR-006's design-of-record deferral; `odometerAtDate` interpolation reads the existing fuel-log timeline, it does not introduce a new persisted distance concept.

## Consequences

**Positive:** reminders stop being permanently silent for users who never logged a `lastServiceDate`/`lastServiceOdometer`; dismissal actually models what was dismissed instead of a distance-offset proxy; loop-close records provenance, closing a class of "why did this reminder reset itself" support questions; PREP-4.3 is finally discharged; unit-aware thresholds remove a mi-user-visible inconsistency; the migration ladder (v1→v6) stays clean and idempotent.

**Negative / risk:** the `odometerAtDate` interpolation (AD-RT-3) is the subtlest new correctness surface in this ADR — a wrong nearest-log selection could anchor a km baseline to the wrong odometer, and it is explicitly flagged for owner confirmation before implementation. The dismissal shape change (AD-RT-4) is a breaking change to the _localStorage_ map's meaning (not Dexie-versioned) — old `{status, odometer}` markers must be treated as absent/expired on first read post-upgrade rather than crashing on the new shape (read-boundary must tolerate the old shape defensively, one release's worth of stale markers is an acceptable, low-stakes loss).

**Decision:** **Accepted.** Owner confirmed both flagged points 2026-07-03: AD-RT-1 includes `lastClosedByExpenseId` as a third additive field; AD-RT-3 uses odometer interpolation at `createdAt` for the km-dimension anchor. Story 8.5 is cleared to leave `ready-for-dev` on this sign-off. Standing gates (AI-1 ship-gate, AI-2 claim-accuracy, independent 3-layer review — AI-5.1) apply; a migration is exactly the kind of "small" story the review-uniformity discipline must not skip.
