import { redirect } from '@sveltejs/kit';
import { resolve } from '$app/paths';
import type { PageLoad } from './$types';

// Universal load redirect — runs client-side in the static SPA (ssr = false).
// Redirects `/` to `/log` during the load phase, before any component
// renders, so the Log tab is active on SvelteKit's first paint.
export const load: PageLoad = () => {
	redirect(307, resolve('/log'));
};
