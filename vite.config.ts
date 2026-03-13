import { sveltekit } from '@sveltejs/kit/vite';
import { SvelteKitPWA } from '@vite-pwa/sveltekit';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vitest/config';
import { readFileSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { createHash } from 'crypto';
import { join } from 'path';

const pkgRaw = readFileSync(fileURLToPath(new URL('./package.json', import.meta.url)), 'utf-8');
const pkg = JSON.parse(pkgRaw);

// Manifest config as a standalone constant so we can derive a content hash for precache revisioning.
// When manifest fields change (name, icons, theme_color, etc.), this hash changes, invalidating
// the cached manifest.webmanifest in Workbox's precache — ensuring stale manifests are not served.
const manifestConfig = {
	name: 'passanger',
	short_name: 'passanger',
	description: 'Personal car fuel and expense tracker',
	display: 'standalone' as const,
	orientation: 'portrait' as const,
	theme_color: '#2563EB',
	background_color: '#F8F7F4',
	start_url: '/',
	icons: [
		{ src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
		{ src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
		{
			src: '/icons/icon-maskable-512.png',
			sizes: '512x512',
			type: 'image/png',
			purpose: 'maskable' as const
		}
	]
};
const manifestRevision = createHash('sha256')
	.update(JSON.stringify(manifestConfig))
	.digest('hex')
	.slice(0, 8);

export default defineConfig({
	plugins: [
		tailwindcss(),
		sveltekit(),
		SvelteKitPWA({
			strategies: 'injectManifest',
			srcDir: 'src',
			filename: 'service-worker.ts',
			registerType: 'prompt',
			injectManifest: {
				// modifyURLPrefix bypasses buildGlobPatterns() in @vite-pwa/sveltekit, which otherwise
				// always appends "prerendered/**/*.{html,json}" — a glob with no matches in SPA mode.
				// The prefix rewrite is semantically equivalent to the plugin's manifestTransform:
				// "client/_app/..." → "_app/..." (same result, no double-strip risk).
				modifyURLPrefix: { 'client/': '' },
				// client/*.webmanifest intentionally excluded: @vite-pwa/sveltekit injects the
				// generated manifest.webmanifest URL into the precache list automatically. Including
				// it here too causes a Workbox `add-to-cache-list-conflicting-entries` error at
				// SW evaluation time (duplicate URL with mismatched revisions).
				globPatterns: ['client/**/*.{js,css,ico,png,svg,webp,woff,woff2}'],
				// Derive the /index.html precache revision from THREE sources combined:
				// 1. .svelte-kit/output/client/.vite/manifest.json — hashed JS/CSS asset
				//    filenames from the current Vite client build phase. Written BEFORE
				//    @vite-pwa/sveltekit's closeBundle hook, so it always reflects the current
				//    build. Captures changes to any JS/CSS source file.
				// 2. src/app.html — the SPA shell HTML template. Changes to this file (adding
				//    <meta> tags, changing the title, updating charset, etc.) do NOT produce new
				//    JS/CSS chunks, so they would be invisible to the Vite manifest alone.
				// 3. svelte.config.js — SvelteKit config including kit.csp directives. Changes
				//    to CSP policy (e.g. adding/removing directives) produce different <meta>
				//    tags in build/index.html but don't change JS/CSS chunks or app.html.
				//
				// Combined, the three-source hash ensures /index.html is invalidated in the
				// precache whenever the JS/CSS bundle, the shell HTML template, OR the SvelteKit
				// config (CSP/meta output) changes.
				//
				// Fallback: if the Vite manifest is absent, hash pkgRaw so the build doesn't fail.
				manifestTransforms: [
					async (manifestEntries) => {
						const viteMfstPath = join(
							process.cwd(),
							'.svelte-kit',
							'output',
							'client',
							'.vite',
							'manifest.json'
						);
						const appHtmlPath = join(process.cwd(), 'src', 'app.html');
						const svelteConfigPath = join(process.cwd(), 'svelte.config.js');

						const hasher = createHash('sha256');
						if (existsSync(viteMfstPath)) {
							hasher.update(readFileSync(viteMfstPath));
						} else {
							hasher.update(pkgRaw); // abnormal fallback; shouldn't occur in npm run build
						}
						if (existsSync(appHtmlPath)) {
							hasher.update(readFileSync(appHtmlPath));
						}
						if (existsSync(svelteConfigPath)) {
							hasher.update(readFileSync(svelteConfigPath));
						}
						const revision = hasher.digest('hex').slice(0, 8);

						// manifestTransforms bypasses the plugin's auto-injection of manifest.webmanifest.
						// Explicitly add it with manifestRevision (a content hash of the manifest config
						// object defined at the top of this file). Unlike `revision: null`, a real revision
						// ensures Workbox invalidates the cached manifest.webmanifest whenever the manifest
						// fields (name, icons, theme_color, etc.) change. `revision: null` is only safe for
						// URLs with a content hash already baked into the URL itself (e.g., hashed JS chunks).
						const hasWebManifest = manifestEntries.some(
							(e) => e.url === 'manifest.webmanifest' || e.url.endsWith('/manifest.webmanifest')
						);
						return {
							manifest: [
								...manifestEntries.filter((e) => e.url !== '/index.html'),
								...(hasWebManifest
									? []
									: [{ url: 'manifest.webmanifest', revision: manifestRevision, size: 0 }]),
								{ url: '/index.html', revision, size: 0 }
							],
							warnings: []
						};
					}
				]
			},
			// Single source of truth: manifestConfig (defined at top of file) drives both
			// the generated manifest.webmanifest AND the precache revision hash. No duplicate
			// manifest block — any change to manifestConfig automatically invalidates the
			// cached manifest.webmanifest via manifestRevision.
			manifest: manifestConfig
		})
	],
	define: {
		'import.meta.env.PUBLIC_APP_VERSION': JSON.stringify(pkg.version)
	}
});
