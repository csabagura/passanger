import { redirect } from '@sveltejs/kit';
import { resolve } from '$app/paths';
import type { PageLoad } from './$types';

// Backward-compatibility redirect: /fuel-entry → /log
// Preserves existing bookmarks and PWA start_url compatibility.
export const load: PageLoad = () => {
	redirect(307, resolve('/log'));
};
