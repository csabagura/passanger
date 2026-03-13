/// <reference types="@sveltejs/kit" />
/// <reference no-default-lib="true"/>
/// <reference lib="esnext" />
/// <reference lib="webworker" />

import {
	cleanupOutdatedCaches,
	precacheAndRoute,
	createHandlerBoundToURL
} from 'workbox-precaching';
import { NavigationRoute, registerRoute } from 'workbox-routing';

declare let self: ServiceWorkerGlobalScope;

// Remove caches from old service worker versions
cleanupOutdatedCaches();

// Precache all static assets (JS, CSS, icons, images) AND the app shell HTML (/index.html).
// index.html is included via globPatterns in vite.config.ts injectManifest config.
// CacheFirst strategy is applied automatically to all precached assets.
precacheAndRoute(self.__WB_MANIFEST);

// Route ALL navigation requests to the precached app shell (SPA offline pattern).
// createHandlerBoundToURL serves /index.html from the precache for every navigation,
// regardless of the actual URL path. This is deterministic: the shell is precached at
// SW installation time, so offline navigation works after the very first warm online visit
// with ZERO network requests — satisfying AC #1 (zero network errors for app shell load).
registerRoute(new NavigationRoute(createHandlerBoundToURL('/index.html')));

// Handle SKIP_WAITING message from virtual:pwa-register updateSW(true) call
// Required for injectManifest strategy: UI sends this message, SW must respond to activate new version
self.addEventListener('message', (event) => {
	if (event.data && event.data.type === 'SKIP_WAITING') {
		self.skipWaiting();
	}
});

// Claim all open clients immediately when the new SW activates.
// Without clients.claim(), the SW activates but doesn't control existing pages —
// Workbox's 'controlling' event never fires, so vite-plugin-pwa's updateSW(true)
// reload call has no effect. clients.claim() completes the prompt-update handoff:
// skipWaiting() → activate → clients.claim() → 'controlling' event → page reload.
self.addEventListener('activate', (event) => {
	event.waitUntil(self.clients.claim());
});
