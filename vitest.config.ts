/**
 * Vitest config for the main unit/integration test suite.
 *
 * Explicitly merges with vite.config.ts to inherit SvelteKit plugins, $lib alias,
 * Svelte preprocessing, PWA config, etc. The resolve.conditions: ['browser'] is
 * placed HERE (test-only) instead of in vite.config.ts so production builds don't
 * carry the test-tooling workaround.
 *
 * CONTEXT: @testing-library/svelte requires the 'browser' export condition to resolve
 * Svelte 5's browser entry in jsdom. Without it, mount() throws "not available on the
 * server". test.resolve.conditions does NOT work in Vitest 4.x (empirically confirmed).
 * Root-level resolve.conditions in a dedicated vitest.config.ts achieves the same effect
 * while keeping production config clean.
 *
 * See docs/adr/001-resolve-conditions-browser.md for full rationale.
 */
import { defineConfig, mergeConfig } from 'vitest/config';
import viteConfig from './vite.config';

export default mergeConfig(
	viteConfig,
	defineConfig({
		resolve: {
			conditions: ['browser']
		},
		test: {
			setupFiles: ['src/test-setup.ts'],
			include: ['src/**/*.{test,spec}.{js,ts}'],
			// precache-manifest.test.ts reads build/service-worker.js — a built artifact.
			// Excluded from the default unit test run (`npm run test`) because `vitest run`
			// on a clean checkout would fail if no build exists yet, breaking the planned
			// CI flow: type-check → lint → unit tests (no build prerequisite).
			// Run separately via `npm run test:artifacts` after `npm run build`.
			exclude: ['src/precache-manifest.test.ts', 'node_modules/**', 'dist/**'],
			environment: 'jsdom',
			globals: true
		}
	})
);
