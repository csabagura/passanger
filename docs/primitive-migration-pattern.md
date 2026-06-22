# Primitive migration pattern

The proven recipe for migrating a hand-rolled screen onto the `ui/*` primitives + `Field`.
First applied to the Settings surface (Story 1.5); follow it for every later per-screen pass
(capture forms, history, import).

## The one rule

**Preserve accessible name + role + handlers; let the tests stay green.** A migration changes
chrome, never behavior. If a test breaks, you lost a role/name/handler — fix the migration, do
not loosen the assertion. Only update a test where the structure legitimately changed (an inline
`<label>+<input>` pair becoming a `<Field>`, asserting the new managed error linkage instead of a
hardcoded id).

## Buttons → `<Button>`

Every CTA uses `<Button>` from `$lib/components/ui/button` with a brand size variant. No
hand-rolled `min-h-11` / `h-[..]` / `px-5 py-3` button chrome remains. Sizes: `sm` 40px /
`default` 44px / `lg` 52px / `icon` 44². Keep `onclick`, `type`, `disabled`, `aria-*` and the
exact button text/`aria-label`.

| Old hand-rolled                                                    | New                                                       |
| ------------------------------------------------------------------ | --------------------------------------------------------- |
| accent CTA `min-h-11 bg-accent` (Add, Download backup)             | `<Button>` (default / default)                            |
| primary form submit (Save settings / Save vehicle / Save reminder) | `<Button type="submit" size="lg">`                        |
| secondary / Cancel `border border-border`                          | `<Button variant="outline">`                              |
| solid destructive (Replace all, Confirm delete)                    | `<Button variant="destructive">`                          |
| icon target Edit `min-h-11 min-w-11 border`                        | `<Button variant="outline" size="icon" aria-label=…>`     |
| icon target Delete `min-h-11 min-w-11 text-destructive`            | `<Button variant="destructive" size="icon" aria-label=…>` |
| preset/segment toggle `min-h-11 aria-pressed`                      | `<Button variant="outline" aria-pressed=…>`               |

**Destructive is tinted, not solid.** `variant="destructive"` renders `bg-destructive/10
text-destructive` — accept the on-brand tinted look for "Replace all" / "Delete". Pass a `class`
override only if a screen genuinely needs solid red; default to the variant for consistency.

**Binding a `<Button>` ref:** its `ref` is typed `HTMLElement | null` (not `HTMLButtonElement`).
Type the local `$state<HTMLElement | null>(null)` and use `bind:ref={el}` (not `bind:this`).

## Inputs → `<Field>`

Single-line labeled **text / number / date** inputs become `<Field label="…" bind:value …>` from
`$lib/components/ui/field`. Field is `Label` (12px uppercase cap) + `Input` (52px, **16px text at
all breakpoints** — the iOS-zoom guard, NFR-3) + a managed inline error.

- Pass `error={someError}` — Field sets `aria-invalid`, generates the error region
  (`role="alert"`), and links it via `aria-describedby`. **Delete the hand-rolled
  `aria-invalid` / `aria-describedby` / error `<p>`** to avoid duplicate ids/regions.
- Field merges a caller `aria-describedby` (e.g. a hint) with its own error id, so help-text
  linkage survives — keep passing it.
- Keep the **label text identical** so `getByLabelText(...)` / Playwright `getByLabel(...)`
  queries still resolve.
- Pass a stable `id` when tests/focus logic depend on it. The error region id is then
  `${id}-error`. Field does not forward the inner input ref, so drive focus recovery with
  `document.getElementById(id)?.focus()`.
- `class` lands on the inner `Input` (e.g. `class="w-32"` to override the default `w-full`).

### Exceptions — stay hand-rolled (restyle only, don't Field-ify)

| Case                                                                       | Why                                      | What to do                                                                                       |
| -------------------------------------------------------------------------- | ---------------------------------------- | ------------------------------------------------------------------------------------------------ |
| File input (`type="file"`)                                                 | Field omits `type`/`files`               | Raw `<input type="file">`; keep its `id`; restyle radii                                          |
| Multi-line `<textarea>`                                                    | Field wraps a single-line `<input>`      | Keep the textarea; add a `ui/label` `Label`; bump to `text-base` (16px)                          |
| Radio / checkbox groups (theme, fuel-unit)                                 | roving-tabindex / `bind:group` contracts | Keep markup + roles; restyle the container with tokens                                           |
| Operational status / error live regions (`role="status"` / `role="alert"`) | Not field validation                     | Leave as inline live regions; do **not** reroute to the `toast` channel in a primitive migration |
| Shared fieldset error (e.g. interval km + days)                            | One error for two inputs                 | Keep the fieldset-level error `<p>`; give each Field chrome only (no `error` prop)               |

## Validation vs. status (AD-API-2)

Field **validation** → inline `Field` error. Transient **operation** status/failure (save,
restore) → the existing inline `role="status"` / `role="alert"` regions. The toast-channel swap is
a separate later per-feature pass — do not fold it into a primitive migration.
