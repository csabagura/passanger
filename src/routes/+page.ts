import { redirect } from '@sveltejs/kit';
import { resolve } from '$app/paths';
import type { PageLoad } from './$types';

// Universal load redirect — runs client-side in the static SPA (ssr = false).
// Redirects `/` to `/fuel-entry` during the load phase, before any component
// renders, so the Fuel tab is active on SvelteKit's first paint.
export const load: PageLoad = () => {
	redirect(307, resolve('/fuel-entry'));
};
