import { redirect } from '@sveltejs/kit';
import { resolve } from '$app/paths';
import type { PageLoad } from './$types';

// Story 4.4: /analytics is merged into the new Understand surface (/understand, AD-3 / PREP-3). The
// three analytics charts moved there (now interactive + view-as-table) alongside the net-new
// maintenance-cost-trend chart and the plain-language insights. /analytics now redirects to /understand
// — preserving bookmarks, the old nav muscle memory, and PWA start_url compatibility.
export const load: PageLoad = () => {
	redirect(307, resolve('/understand'));
};
