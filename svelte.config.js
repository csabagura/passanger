import adapter from '@sveltejs/adapter-static';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

/** @type {import('@sveltejs/kit').Config} */
const config = {
	preprocess: vitePreprocess(),
	kit: {
		adapter: adapter({ fallback: 'index.html' }),
		// Disable SvelteKit's built-in SW registration. vite-plugin-pwa uses
		// `virtual:pwa-register` (in UpdatePrompt.svelte) as the sole registration
		// and update path. Having both active causes double registration, mismatched
		// SW lifecycle events, and prompt-update breakage.
		// See: https://vite-pwa-org.netlify.app/frameworks/sveltekit.html#service-worker-registration
		serviceWorker: {
			register: false
		},
		// CSP: mode 'hash' auto-generates SHA-256 hashes for SvelteKit's inline bootstrap
		// script and injects a <meta http-equiv="CSP"> tag in the built HTML. This replaces
		// the static CSP in static/_headers which could not include per-build script hashes
		// and blocked the inline bootstrap (app would not boot in production — NFR19).
		// style-src 'unsafe-inline': needed for SvelteKit's <div style="display: contents">
		// (CSP hashes only work for <style> elements, not style attributes).
		// connect-src 'none': enforces zero off-device data transmission (architecture privacy
		// contract). Service worker registration/updates use navigator.serviceWorker.register()
		// which is governed by worker-src, not connect-src. No fetch()/XHR calls exist in MVP.
		// worker-src 'self': explicitly allows same-origin service worker registration.
		csp: {
			mode: 'hash',
			directives: {
				'default-src': ['self'],
				'script-src': ['self'],
				'style-src': ['self', 'unsafe-inline'],
				'img-src': ['self', 'data:'],
				'connect-src': ['none'],
				'worker-src': ['self'],
				'object-src': ['none'],
				'base-uri': ['self']
			}
		}
	}
};

export default config;
