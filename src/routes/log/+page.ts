import { redirect } from '@sveltejs/kit';
import { resolve } from '$app/paths';
import type { PageLoad } from './$types';

// Story 3.3: /log is retired as a surface. The inline Fuel/Service forms it owned are superseded by
// the global Capture sheet (canonical post-3.2), and its first-run / reminders responsibilities moved
// to Home. /log now redirects to Home with the Capture sheet opened on Fuel — preserving bookmarks,
// PWA start_url compatibility, and the old nav muscle memory. The `?capture=fuel` query survives the
// redirect; the layout deep-link $effect opens the sheet and strips the param via replaceState.
export const load: PageLoad = () => {
	redirect(307, resolve('/') + '?capture=fuel');
};
