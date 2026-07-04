# ADR-008 — Vehicle archive & identity (Dexie v7)

- **Status:** **Accepted** (2026-07-04 — owner Csabagura signed off **as written**: all five decision points AD-VA-1..6 at their recommended defaults, no amendment. Discharges **PREP-9.1**; Story 9.2 gate cleared). Drafted acting-as-architect on the ADR-005/006/007 precedent.
- **Date:** 2026-07-04
- **Deciders:** Architect (draft), Csabagura (PO/Project Lead — sign-off pending)
- **Scope (strictly additive):** two optional non-indexed fields on `Vehicle`. No table add/drop, no field removal/rename, **no `.stores()` index change**, no type-narrowing of existing fields.
- **Context source:** Epic 9 (`epics.md`), owner feature request 2026-07-04 (onboarding / soft-delete-archive / delete-then-re-add odometer persistence / share-a-car). Baseline verified at `main @ 9ef9bab` (post Story 8-6) via a current-HEAD code-mapper.
- **Related:** ADR-005 (v4→v5), ADR-006 (one write boundary — the `runWrite`/validator skeleton archive/restore plug into), ADR-007 (v5→v6 pattern this migration mirrors).

---

## Context

`DB_VERSION = 6` (`config.ts:44`). `MAX_VEHICLES = 5` (`config.ts:56`). The `Vehicle` interface (`schema.ts:1-7`) is `id` (auto-increment PK) + `name`/`make`/`model` + optional `year` — **no natural key (no plate, no VIN).**

Today `deleteVehicle(id)` (`vehicles.ts:64-90`) is a **hard cascade** inside one `runWrite` transaction: existence-check → delete owned `fuelLogs`/`expenses`/`serviceReminders` by `vehicleId` → delete the vehicle row. A deleted car is unrecoverable, and because there is no natural key, deleting-then-re-adding "the same car" mints a brand-new `id` with zero link to the old odometer or history — the user's mileage silently resets.

The owner wants: archive instead of destroy; odometer + history that survive; restore of the identical car; and a delete-then-re-add that never silently loses mileage. All four are one feature: **soft-delete with a stable identity.**

## Decision

### AD-VA-1 — Schema deltas (`src/lib/db/schema.ts`, additive, non-indexed)

Add to `Vehicle`:

- `isArchived?: boolean` — absent/`false` = active; `true` = archived (soft-deleted).
- `archivedAt?: number` — epoch ms when archived (for an "archived on…" label / future purge policy); unset when active.

Not added to any `.stores()` string — the vehicle list is ≤5 rows and filtered in memory, so no index is warranted (v5/v6 precedent).

### AD-VA-2 — Migration (`src/lib/db/migrations/v7.ts` → `migrateV6ToV7`)

`this.version(7).stores({ …the same 4 strings verbatim… }).upgrade(migrateV6ToV7)` in `db.ts`; bump `DB_VERSION = 7`. Migration idempotently backfills `isArchived = false` where absent (`.toCollection().modify(v => { if (v.isArchived == null) v.isArchived = false })`), exactly the v5/v6 backfill shape. `archivedAt` stays undefined for existing (active) vehicles.

### AD-VA-3 — Identity: retain the row, flip the flag (**recommended default**)

Archive **never deletes the vehicle row**, so `id` stays stable and every child `vehicleId` FK stays attached automatically — odometer and history persist by construction. Restore = `updateVehicle(id, { isArchived: false, archivedAt: undefined })`; no re-linking, no matching, no new identity infrastructure. A user-visible natural key (plate/VIN) is explicitly **not** introduced (it would need a new field + uniqueness enforcement + backup/import handling for zero benefit here).

**Accepted corollary:** with no natural key, if a user _re-creates_ a vehicle that duplicates an archived one (instead of restoring it), the system cannot detect the duplicate — two rows for "the same car" can exist. Archive→Restore is the intended reuse path; re-create is the user's choice. The onboarding wizard (9.1) and the archive UI (9.2) should nudge toward Restore when archived vehicles exist.

### AD-VA-4 — Archived vehicles do NOT count toward `MAX_VEHICLES` (**recommended default**)

The cap is a _usability_ limit on active cars, not a storage limit. Archiving a car must free a slot, or "archive to add a new one" is broken. Therefore the count guard becomes **active-only**:

- `saveVehicle` (`vehicles.ts:12-13`) `db.vehicles.count()` → a filtered active count (`getActiveVehicleCount()` / `where isArchived != true`).
- `validateVehicleCount` (`rowValidation.ts:375-376`, used by backup import) → counts **active** vehicles only, so a backup of 5 active + N archived imports cleanly.

### AD-VA-5 — Reversible-until-purged, with an explicit permanent-delete (**recommended default**)

Archive is reversible indefinitely. The current hard cascade (`deleteVehicle`) is **retained as a distinct "Delete permanently" (purge) action** — the only path that destroys data — reachable only from the Archived list, behind an explicit confirmation. No automatic time-based purge in v1 (`archivedAt` merely records when, for a possible future policy).

### AD-VA-6 — Read-layer filtering + active-vehicle-is-archived behavior

Archived vehicles are excluded from the **active** set at the single read funnel `getAllVehicles()` (filter to active, plus a sibling `getArchivedVehicles()` for the Archived UI). Every current reader inherits this: the layout `'vehicles'` context (`+layout.svelte`), `VehicleSwitcher`, `VehicleListManager` (its own list), Settings, `CaptureSheet`, the import steps, and all dashboards. If the currently-active vehicle is archived, the layout's existing **S19 fallback `$effect` is the single owner** that re-points `activeVehicleId` to the first remaining active vehicle (or the onboarding/empty state if none remain) — no second fallback owner is introduced (8.6 review discipline). `readStoredVehicleId()` / the export-recovery path resolve an archived stored id the same way.

## Files in scope (Story 9.2)

**NEW:** `src/lib/db/migrations/v7.ts` (+ `v7.test.ts`); this ADR.
**UPDATE:** `schema.ts` (Vehicle fields), `db.ts` (`version(7)` block), `config.ts` (`DB_VERSION=7`), `vehicles.ts` (`archiveVehicle`/`restoreVehicle` via `runWrite`+`updateVehicle`; keep `deleteVehicle` as purge; active-only count; `getAllVehicles` filter + `getArchivedVehicles`), `VehicleListManager.svelte` (Archived section + Restore + permanent-delete), possibly `+layout.svelte`/`vehicleStorage.ts`/`export/+page.svelte` for the archived-active case, `rowValidation.ts` (active-only `validateVehicleCount`). Test updates: `vehicles.test.ts`, `config.test.ts` (DB_VERSION assertion — grep it, this bit 7-1/8-5), `backup.test.ts`, `VehicleListManager.test.ts`.

## Testing mandates

Regression tests for: archive (row + children retained), restore (identical car back), permanent-delete (true cascade), active-vehicle-archived → S19 re-point, v6→v7 migration idempotency, v6-backup restore into v7, `MAX_VEHICLES` active-only (archive frees a slot; backup with archived rows imports), and archived-excluded-from-every-active-read. Real-path e2e (AI-5.3). `test:artifacts` per PREP-4.1.

## Fences (hard)

- ADR-006 write boundary: archive/restore/purge are `runWrite` writes through the shared validators + sentinel codec; `notifyDataChanged` only on success.
- Additive/idempotent migration; `.stores()` strings unchanged; backfill `?? false`; single batch timestamp.
- Dexie-isolation ESLint (db-layer only).
- `$state`/context reactivity: keep the H12 dual-list reconciliation; the S19 `$effect` remains the single fallback owner.
- **No CSP/network/privacy change** — all local IndexedDB; `connect-src 'none'` intact.

## Consequences

**Positive:** delete-then-re-add can no longer silently reset mileage (restore is the path); mistaken deletes are recoverable; archiving frees a slot; zero new identity infrastructure; strictly additive/low-risk migration on a proven pattern. **Negative / accepted:** no dup-detection on re-create (AD-VA-3 corollary); archived rows consume a little storage until purged; every active-read gains a cheap in-memory filter. **Owner decision points (sign-off):** AD-VA-3 identity approach, AD-VA-4 archived-vs-cap, AD-VA-5 reversible-vs-purgeable, AD-VA-1/2 index-or-not (defaulted non-indexed), AD-VA-6 archived-UI surface + active-archived re-point.
