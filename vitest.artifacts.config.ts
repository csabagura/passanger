/**
 * Vitest config for build-artifact tests.
 *
 * These tests read files from the `build/` directory and require `npm run build`
 * to have been run first. They are intentionally excluded from the main test suite
 * (`npm run test`) to keep the unit-test CI step free of build prerequisites.
 *
 * Usage: `npm run test:artifacts` (run after `npm run build`)
 */
import { defineConfig } from 'vitest/config';

export default defineConfig({
	test: {
		include: ['src/precache-manifest.test.ts'],
		environment: 'node',
		globals: true
	}
});
