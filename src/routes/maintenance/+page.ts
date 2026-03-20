import { redirect } from '@sveltejs/kit';
import { resolve } from '$app/paths';
import type { PageLoad } from './$types';

// Backward-compatibility redirect: /maintenance → /log
// Preserves existing bookmarks.
export const load: PageLoad = () => {
	redirect(307, resolve('/log'));
};
