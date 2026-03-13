/**
 * Build-artifact regression guard: precache manifest duplicate URL check
 *
 * PURPOSE:
 * Verify the generated `build/service-worker.js` does not contain duplicate URLs in the
 * injected Workbox precache manifest. Duplicate URLs cause a runtime
 * `add-to-cache-list-conflicting-entries` Workbox error that silently breaks precaching.
 *
 * ROOT CAUSE HISTORY (Story 1.3, pass-7 review):
 * `injectManifest.globPatterns` originally included `client/*.webmanifest`, which matched
 * the generated `manifest.webmanifest`. The `@vite-pwa/sveltekit` plugin also injects this
 * URL automatically, resulting in two entries for the same URL with different revisions.
 * Fix: removed `client/*.webmanifest` from globPatterns (plugin handles the manifest URL).
 *
 * EXECUTION REQUIREMENT:
 * This test reads the BUILD artifact. Run `npm run build` before running this test suite.
 * In CI, ensure the build step precedes the test step.
 *
 * FAILURE POLICY:
 * If build/service-worker.js is absent, ALL tests in this suite FAIL with a clear message.
 * This is intentional: the guard must not silently skip — a missing build artifact means
 * the regression it was added to catch cannot be verified.
 *
 * WHAT IS CHECKED:
 * 1. Precache manifest URLs are all unique (no duplicates).
 * 2. The built service-worker.js contains a valid precache manifest (sanity check).
 * 3. manifest.webmanifest appears exactly once (guards against double-injection regression).
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync, existsSync, readdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { join, dirname } from 'path';
import { gzipSync } from 'zlib';

const rootDir = dirname(dirname(fileURLToPath(import.meta.url)));
const swBuildPath = join(rootDir, 'build', 'service-worker.js');
const indexHtmlPath = join(rootDir, 'build', 'index.html');

describe('precache manifest — build-artifact regression guard', () => {
	beforeAll(() => {
		if (!existsSync(swBuildPath)) {
			throw new Error(
				'build/service-worker.js not found. Run `npm run build` before this test suite. ' +
					'This file contains build-artifact regression guards that require a built output. ' +
					'In CI, ensure the build step runs before the test step.'
			);
		}
	});

	it('build/service-worker.js exists (build was run before this test)', () => {
		expect(existsSync(swBuildPath)).toBe(true);
	});

	it('precache manifest contains no duplicate URLs', () => {
		const swContent = readFileSync(swBuildPath, 'utf-8');

		// Extract all URL strings from the inlined precache manifest array.
		// Workbox injectManifest produces entries like {"revision":"abc","url":"/path"} —
		// keys are double-quoted JSON-style in the minified bundle output.
		const urlMatches = [...swContent.matchAll(/"url":"([^"]+)"/g)];
		const urls = urlMatches.map((m) => m[1]);

		expect(urls.length).toBeGreaterThan(0); // sanity: manifest is non-empty

		const uniqueUrls = new Set(urls);
		const duplicates = urls.filter((url, idx) => urls.indexOf(url) !== idx);

		expect(duplicates).toEqual([]); // fail with the actual duplicate list if any found
		expect(uniqueUrls.size).toBe(urls.length);
	});

	it('manifest.webmanifest appears exactly once in the precache manifest', () => {
		const swContent = readFileSync(swBuildPath, 'utf-8');

		// manifest.webmanifest was the specific duplicate in the regression that triggered
		// this story's pass-7 review findings. It was added both by globPatterns and by
		// @vite-pwa/sveltekit's automatic manifest injection.
		// Fix: removed `client/*.webmanifest` from globPatterns — plugin handles it alone.
		// Guard: count occurrences; any value other than 1 indicates a regression.
		const occurrences = [...swContent.matchAll(/"url":"manifest\.webmanifest"/g)].length;
		expect(occurrences).toBe(1); // exactly once — no duplicate, not absent
	});
});

describe('HTML shell — service-worker registration path guard', () => {
	// PURPOSE:
	// SvelteKit auto-injects `navigator.serviceWorker.register('/service-worker.js')` into
	// `build/index.html` unless `kit.serviceWorker.register = false` is set in svelte.config.js.
	// When using vite-plugin-pwa with `virtual:pwa-register`, this SvelteKit default registration
	// creates a second, unmanaged SW lifecycle path that competes with the pwa-register path,
	// breaking the prompt-update flow and potentially causing stale SW activations.
	//
	// FIX: `svelte.config.js` sets `kit.serviceWorker.register = false` (Story 1.3, pass-10 review).
	// GUARD: Verify the fix holds — built index.html must NOT contain the SvelteKit snippet.

	beforeAll(() => {
		if (!existsSync(indexHtmlPath)) {
			throw new Error(
				'build/index.html not found. Run `npm run build` before this test suite. ' +
					'In CI, ensure the build step runs before the test step.'
			);
		}
	});

	it('build/index.html exists (build was run before this test)', () => {
		expect(existsSync(indexHtmlPath)).toBe(true);
	});

	it('build/index.html does NOT contain SvelteKit default SW registration snippet', () => {
		const html = readFileSync(indexHtmlPath, 'utf-8');

		// SvelteKit injects this exact snippet when serviceWorker.register is not disabled.
		// Its presence means both SvelteKit's registration AND vite-plugin-pwa's are active,
		// creating a double-registration that breaks prompt-based updates.
		expect(html).not.toContain("navigator.serviceWorker.register('/service-worker.js')");
	});

	it('build/index.html contains the PWA manifest link (installability prerequisite)', () => {
		const html = readFileSync(indexHtmlPath, 'utf-8');

		// vite-plugin-pwa injects the manifest link, OR it's in src/app.html directly.
		// Either way, the built HTML must include the <link rel="manifest"> for PWA installability.
		expect(html).toContain('rel="manifest"');
	});
});

describe('HTML shell — CSP compliance guard', () => {
	// PURPOSE:
	// Validate that build/index.html is compliant with its own CSP.
	// SvelteKit generates an inline bootstrap <script> and <div style="display: contents">.
	// The CSP (generated by kit.csp mode: 'hash') must include:
	//   - A SHA-256 hash for the inline script in script-src
	//   - 'unsafe-inline' in style-src for inline style attributes
	//   - connect-src 'none' for zero off-device transmission (architecture privacy contract)
	//   - worker-src 'self' for explicit same-origin service worker registration
	// Without the hash, the app does not boot (script blocked).
	// Without 'unsafe-inline', the layout breaks (style blocked).
	//
	// ROOT CAUSE (Story 1.3, pass-13 review):
	// static/_headers had `script-src 'self'` which blocked the inline bootstrap.
	// FIX: CSP moved to kit.csp (mode: 'hash'), global static/_headers no longer contains CSP.
	// Path-specific CSP for /service-worker.js is still in _headers (SW execution context).

	beforeAll(() => {
		if (!existsSync(indexHtmlPath)) {
			throw new Error(
				'build/index.html not found. Run `npm run build` before this test suite. ' +
					'In CI, ensure the build step runs before the test step.'
			);
		}
	});

	it('build/index.html contains a CSP meta tag', () => {
		const html = readFileSync(indexHtmlPath, 'utf-8');
		expect(html).toContain('http-equiv="content-security-policy"');
	});

	it('CSP script-src includes a SHA-256 hash for the inline bootstrap script', () => {
		const html = readFileSync(indexHtmlPath, 'utf-8');

		// kit.csp mode: 'hash' generates a SHA-256 hash for the inline bootstrap script.
		// Without the hash, the inline script is blocked and the app does not boot.
		const cspMatch = html.match(/content="([^"]*script-src[^"]*)"/);
		expect(cspMatch).not.toBeNull();

		const cspContent = cspMatch![1];
		expect(cspContent).toMatch(/script-src[^;]*'sha256-[A-Za-z0-9+/=]+'/);
	});

	it('CSP style-src allows inline styles (for SvelteKit display: contents)', () => {
		const html = readFileSync(indexHtmlPath, 'utf-8');

		const cspMatch = html.match(/content="([^"]*style-src[^"]*)"/);
		expect(cspMatch).not.toBeNull();

		const cspContent = cspMatch![1];
		expect(cspContent).toMatch(/style-src[^;]*'unsafe-inline'/);
	});

	it("CSP connect-src is 'none' (architecture zero-network privacy contract)", () => {
		const html = readFileSync(indexHtmlPath, 'utf-8');

		// connect-src 'none' enforces zero off-device data transmission.
		// Service worker registration uses navigator.serviceWorker.register() which is
		// governed by worker-src, not connect-src. No fetch()/XHR calls exist in MVP.
		const cspMatch = html.match(/http-equiv="content-security-policy"\s+content="([^"]*)"/);
		expect(cspMatch).not.toBeNull();

		const cspContent = cspMatch![1];
		expect(cspContent).toMatch(/connect-src 'none'/);
	});

	it("CSP worker-src is 'self' (explicit same-origin SW registration)", () => {
		const html = readFileSync(indexHtmlPath, 'utf-8');

		// worker-src 'self' explicitly allows same-origin service worker registration.
		// Without it, worker-src falls back to child-src → script-src → default-src.
		// Explicit is better than implicit for security policy clarity.
		const cspMatch = html.match(/http-equiv="content-security-policy"\s+content="([^"]*)"/);
		expect(cspMatch).not.toBeNull();

		const cspContent = cspMatch![1];
		expect(cspContent).toMatch(/worker-src 'self'/);
	});

	it('static/_headers global CSP only contains frame-ancestors (no document-level directives)', () => {
		const headersPath = join(rootDir, 'static', '_headers');
		if (!existsSync(headersPath)) {
			return; // no _headers file is acceptable — CSP is in the meta tag
		}
		const headers = readFileSync(headersPath, 'utf-8');

		// The global /* section may contain `Content-Security-Policy: frame-ancestors 'none'`
		// because frame-ancestors CANNOT be set via a <meta> tag — it must be a response header.
		// However, the global section must NOT contain document-level CSP directives
		// (default-src, script-src, style-src, etc.) because:
		// 1. _headers cannot include per-build script hashes (kit.csp handles this)
		// 2. A document-level CSP in _headers would conflict with the meta tag CSP
		// Path-specific CSP (e.g. /service-worker.js) is allowed and expected.
		const globalSection = headers.split('/service-worker.js')[0];
		// Extract only actual header lines (not comments or path selectors)
		const headerLines = globalSection
			.split('\n')
			.filter((line) => line.startsWith('  ') && !line.trimStart().startsWith('#'));
		const documentDirectives = ['default-src', 'script-src', 'style-src', 'connect-src', 'img-src'];
		for (const line of headerLines) {
			for (const directive of documentDirectives) {
				expect(line).not.toContain(directive);
			}
		}
	});

	it('static/_headers contains a CSP for /service-worker.js', () => {
		const headersPath = join(rootDir, 'static', '_headers');
		expect(existsSync(headersPath)).toBe(true);

		const headers = readFileSync(headersPath, 'utf-8');

		// The SW execution context is NOT governed by the document's CSP meta tag.
		// A path-specific CSP header for the SW script response provides defense-in-depth.
		expect(headers).toContain('/service-worker.js');
		expect(headers).toMatch(/\/service-worker\.js[\s\S]*Content-Security-Policy/);
	});
});

describe('Performance budget — bundle size', () => {
	it('total JS bundle is under 150KB gzipped (NFR4)', () => {
		const chunksDir = join(rootDir, 'build', '_app', 'immutable', 'chunks');
		const entryDir = join(rootDir, 'build', '_app', 'immutable', 'entry');
		const nodesDir = join(rootDir, 'build', '_app', 'immutable', 'nodes');

		expect(existsSync(chunksDir)).toBe(true);

		const MAX_GZIPPED_JS_BYTES = 150 * 1024; // 150KB gzipped (NFR4)

		let totalGzippedBytes = 0;
		for (const dir of [chunksDir, entryDir, nodesDir]) {
			if (!existsSync(dir)) continue;
			const files = readdirSync(dir).filter((f) => f.endsWith('.js'));
			for (const file of files) {
				const raw = readFileSync(join(dir, file));
				totalGzippedBytes += gzipSync(raw).byteLength;
			}
		}

		expect(totalGzippedBytes).toBeLessThan(MAX_GZIPPED_JS_BYTES);
	});
});

describe('PWA capability — installability requirements', () => {
	// PURPOSE:
	// Lighthouse 12 removed the PWA category entirely. These tests verify the concrete
	// installability and offline requirements that the PWA score previously covered:
	// manifest fields, icon assets, service worker precaching, and offline navigation.

	const manifestPath = join(rootDir, 'build', 'manifest.webmanifest');

	beforeAll(() => {
		if (!existsSync(manifestPath)) {
			throw new Error(
				'build/manifest.webmanifest not found. Run `npm run build` before this test suite.'
			);
		}
	});

	it('manifest.webmanifest has all required installability fields', () => {
		const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'));

		expect(manifest.name).toBeTruthy();
		expect(manifest.short_name).toBeTruthy();
		expect(manifest.display).toBe('standalone');
		expect(manifest.start_url).toBe('/');
		expect(manifest.theme_color).toBeTruthy();
		expect(manifest.background_color).toBeTruthy();
	});

	it('manifest.webmanifest declares 192px, 512px, and maskable icons', () => {
		const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'));
		const icons: Array<{ sizes?: string; purpose?: string }> = manifest.icons;

		expect(icons).toBeDefined();
		expect(icons.length).toBeGreaterThanOrEqual(3);

		const has192 = icons.some((i) => i.sizes === '192x192');
		const has512 = icons.some((i) => i.sizes === '512x512' && i.purpose !== 'maskable');
		const hasMaskable = icons.some((i) => i.purpose === 'maskable');

		expect(has192).toBe(true);
		expect(has512).toBe(true);
		expect(hasMaskable).toBe(true);
	});

	it('all manifest icon files exist in the build output', () => {
		const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'));
		const icons: Array<{ src: string }> = manifest.icons;

		for (const icon of icons) {
			// Icon src paths are relative to site root (e.g., "/icons/icon-192.png")
			const iconPath = join(rootDir, 'build', icon.src.replace(/^\//, ''));
			expect(existsSync(iconPath), `Missing icon: ${icon.src}`).toBe(true);
		}
	});

	it('service worker precaches the app shell (/index.html)', () => {
		const swContent = readFileSync(swBuildPath, 'utf-8');
		const urlMatches = [...swContent.matchAll(/"url":"([^"]+)"/g)];
		const urls = urlMatches.map((m) => m[1]);

		expect(urls).toContain('/index.html');
	});

	it('service worker registers a NavigationRoute for offline SPA routing', () => {
		const swContent = readFileSync(swBuildPath, 'utf-8');

		// NavigationRoute is a Workbox class with unique property names `_allowlist` and
		// `_denylist` that survive minification. These properties exist ONLY in NavigationRoute
		// (not in Route, RegExpRoute, or any other Workbox class). If the
		// `registerRoute(new NavigationRoute(createHandlerBoundToURL('/index.html')))` call
		// were removed from src/service-worker.ts, tree-shaking would eliminate the entire
		// NavigationRoute class definition, removing these identifiers from the built output.
		//
		// Why not check `createHandlerBoundToURL`? That name also appears as a method on
		// PrecacheController (which is always bundled for precaching), so it would remain in
		// the build even without NavigationRoute registration.
		expect(swContent).toContain('_allowlist');
		expect(swContent).toContain('_denylist');
	});
});
