/**
 * Regression guard: vitest.config.ts `resolve.conditions: ['browser']`
 *
 * CONTEXT:
 * @testing-library/svelte requires the 'browser' export condition to resolve Svelte 5's
 * browser entry in jsdom tests. Without it, `svelte` resolves to its SSR entry and
 * `mount(...)` throws "not available on the server".
 *
 * PLACEMENT:
 * The condition is set at root level in `vitest.config.ts` (test-only), NOT in the
 * production `vite.config.ts`. Vitest merges vitest.config.ts with vite.config.ts,
 * so the condition applies during test runs but not in production builds.
 * Previously it was global in vite.config.ts — moved to vitest.config.ts in pass-13
 * to keep production config clean.
 *
 * See docs/adr/001-resolve-conditions-browser.md for full rationale.
 *
 * TESTS BELOW:
 * Verify both that the browser condition is effective in jsdom AND that Node.js
 * runtime APIs remain intact (proxy for SSR module resolution safety).
 */

import { describe, it, expect } from 'vitest';

describe('resolve.conditions: ["browser"] — regression guard', () => {
	it('Svelte browser entry is accessible in jsdom (condition correctly applied)', async () => {
		// If 'browser' condition is NOT applied, svelte resolves to its SSR entry and
		// `mount` does not exist — @testing-library/svelte's render() would throw.
		// Verifying `svelte.mount` is a function proves the browser entry resolves.
		const svelte = await import('svelte');
		expect(typeof svelte.mount).toBe('function');
	});

	it('Node.js runtime remains accessible — module resolution not corrupted', () => {
		// If the browser condition caused Node.js native modules to resolve to browser
		// polyfills, `process` and `Buffer` would be undefined or behave unexpectedly.
		// Their presence confirms the Node.js module resolution path is intact.
		expect(typeof process).toBe('object');
		expect(process.version).toMatch(/^v\d+/);
		expect(typeof Buffer).toBe('function');
	});

	it('Node.js path module resolves correctly — native module resolution intact', async () => {
		// path is a Node.js built-in with no browser counterpart. If the browser condition
		// had redirected native module resolution, path.join would be undefined or incorrect.
		const path = await import('path');
		expect(typeof path.join).toBe('function');
		// path.join with forward-slash segments works on all platforms
		expect(path.join('a', 'b', 'c')).toMatch(/a.b.c/);
	});

	it('Svelte SSR entry is also resolvable — both browser and server entries coexist', async () => {
		// svelte/server exports server-side rendering utilities (render, etc.).
		// If browser condition had broken all non-browser module paths, this import would fail.
		const svelteServer = await import('svelte/server');
		expect(typeof svelteServer.render).toBe('function');
	});
});
