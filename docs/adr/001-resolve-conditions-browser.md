# ADR 001: `resolve.conditions: ['browser']` in Vitest Config

- **Status:** Accepted (Updated)
- **Date:** 2026-03-08
- **Story:** 1.3 (PWA Manifest, Service Worker & Offline Cache)

## Context

`@testing-library/svelte` requires the `browser` export condition to resolve Svelte 5's browser entry (`svelte` → browser module). Without this condition in the jsdom test environment, Svelte resolves to its SSR entry and `mount(...)` throws:

```
lifecycle_function_unavailable: mount(...) is not available on the server
```

## Decision

Place `resolve.conditions: ['browser']` at root level in `vitest.config.ts` (test-only), NOT in production `vite.config.ts`:

```typescript
// vitest.config.ts
import { mergeConfig, defineConfig } from 'vitest/config';
import viteConfig from './vite.config';

export default mergeConfig(
	viteConfig,
	defineConfig({
		resolve: { conditions: ['browser'] },
		test: {
			/* ... */
		}
	})
);
```

### Migration History

1. **Initially:** Condition placed globally in `vite.config.ts` because `test.resolve.conditions` didn't propagate in Vitest 4.x.
2. **Belt-and-suspenders:** `ssr.resolve.conditions: ['node', 'import']` added to prevent leakage.
3. **Final (pass-13):** Moved to dedicated `vitest.config.ts` with explicit `mergeConfig`. Production `vite.config.ts` no longer contains the browser condition or SSR condition overrides.

## Rationale

- `test.resolve.conditions` inside `vite.config.ts` does NOT work — Vitest 4.x doesn't propagate it to all module loaders (confirmed empirically).
- Root-level `resolve.conditions` in a separate `vitest.config.ts` works because it's at the same config depth as the previous global placement, but Vitest only loads this file during test runs.
- Production `vite build` reads only `vite.config.ts` — no browser condition, no SSR override needed.

## Regression Guardrails

`src/resolve-conditions.test.ts` provides 4 executable regression tests:

1. **Svelte browser entry accessible** — `svelte.mount` is a function
2. **Node.js runtime intact** — `process.version` and `Buffer` exist
3. **Native module resolution intact** — `path.join` works correctly
4. **SSR entry coexists** — `svelte/server` exports `render`

## Consequences

- **Positive:** Production config is clean — no test-tooling workarounds ship to production
- **Positive:** Tests pass reliably with `@testing-library/svelte` + Svelte 5
- **Positive:** No `ssr.resolve.conditions` override needed (was belt-and-suspenders)
- **Negative:** Requires explicit `mergeConfig` import in `vitest.config.ts`
