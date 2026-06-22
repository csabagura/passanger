# ADR 002: Internationalization via Paraglide JS (compiler-based, CSP-safe)

- **Status:** Proposed (candidate — pending implementation Quick Dev)
- **Date:** 2026-06-15
- **Research:** `_bmad-output/planning-artifacts/research/technical-i18n-strategy-research-2026-06-15.md`

## Context

passanger needs UI internationalization (English + Hungarian — the primary user is a Hungarian/Ft user). The choice is tightly constrained by the product's architecture and privacy contract:

- **CSP `connect-src 'none'`** — zero off-device network calls. Any i18n library that lazy-loads translation JSON over the network at runtime is disqualified.
- **Static, server-less deploy** — `@sveltejs/adapter-static` with SPA fallback; no SSR, no `+server.ts`, no cookies. Locale must persist client-side (`localStorage`).
- **Svelte 5 runes-only** + TS `strict`/`checkJs`; constants in `config.ts`; Prettier law.
- **Tight mobile perf budget** (`.lighthouserc.cjs`): performance ≥ 0.85, FCP ≤ 2s, TTI ≤ 3s, CLS ≤ 0.1.

The date/number layer is already `Intl`-based and locale-parameterized (`src/lib/utils/date.ts`, `src/lib/utils/analytics.ts`), and `src/test-setup.ts` already pins `Intl` and reasons about Hungarian output. The open decision was therefore the **message/translation library**, where the gating question is: _does it touch the network at runtime?_

Candidates evaluated: **Paraglide JS** (compiler-based), **typesafe-i18n** (compiled, type-safe), **svelte-i18n** (runtime, store-based). See the research report for the full matrix and citations.

## Decision

Adopt **Paraglide JS 2.x** (inlang/opral) as the i18n library, configured for a static SPA:

- **Compiler-based messages** — translations compile to bundled, tree-shakeable ESM functions; **no runtime network fetch** (verified from primary-source docs). Requires **no CSP change** and no `unsafe-eval`.
- **Locale strategy** `["localStorage", "preferredLanguage", "baseLocale"]` — persisted user choice → browser `navigator.languages` → base locale (`en`). All offline. **Do not enable the `url` strategy** (it causes adapter-static + SPA 404s, paraglide-js#503).
- **Setup via the Paraglide 2.0 path** (`npx sv add paraglide` / `paraglideVitePlugin`), not the deprecated pre-2.0 `paraglide-sveltekit` adapter.
- **Switching** uses the default reload-on-switch (`setLocale`) — acceptable for a rare Settings action; the PWA rehydrates from IndexedDB on reload. Reactive no-reload switching is a possible later enhancement, not v1.
- **Formatting stays on `Intl`** — thread the active locale (`getLocale()`) into the existing `formatLocalCalendarDate` / analytics formatters; `formatCurrency` is unchanged.
- Add `SUPPORTED_LOCALES` / `DEFAULT_LOCALE` to `config.ts`; gitignore + prettier/eslint-ignore the generated output dir.

## Rationale

- **CSP-safe by construction (decisive).** Primary-source docs confirm messages are bundled JS (not fetched) and that every locale strategy makes zero network requests; `localStorage` is "browser-only… fully functional without server." This is the only candidate that satisfies `connect-src 'none'` without careful per-loader configuration.
- **Smallest footprint under a mobile budget.** Tree-shaking ships only used messages (~47 KB vs i18next ~205 KB for a comparable catalog, flat as the catalog grows); no runtime ICU parser to execute on a 4×-throttled CPU.
- **Runes-native + type-safe**, aligning with the project's "runes only" and TS-strict rules. svelte-i18n is store-based; typesafe-i18n, while type-safe, is **unmaintained (~2 years)** — an unacceptable longevity risk.
- **Officially recommended for SvelteKit** and actively maintained (v2.18.1 at research time).
- **Avoids the static-adapter pitfall** by using the persistence strategy we wanted anyway (`localStorage`), not URL routing.

## Consequences

- **Positive:** No CSP/privacy-contract changes; no network calls added. Minimal bundle impact; budget-friendly. Type-safe message access. The existing `Intl` formatting and `test-setup.ts` harness keep working with a threaded locale.
- **Positive:** First-run UX for HU users is automatic (`preferredLanguage`), with a persisted manual override.
- **Negative / cost:** The real effort is **string extraction across 37 components / 8 routes** (incl. `aria-label`/`placeholder`/`title`) plus authoring HU translations — to be scoped as a route-by-route migration, not a one-shot change.
- **Negative:** A build-step dependency (the Paraglide compiler/Vite plugin) and a generated, gitignored output directory to manage.
- **Watch-outs:** ignore pre-2.0 tutorials; never enable the `url` strategy; re-measure Lighthouse after the spike to confirm the added payload stays within budget.

## Follow-up

Implement via `bmad-quick-dev` using the PoC/implementation plan in §10 of the research report. Promote this ADR's status from **Proposed** to **Accepted** when that work lands.
