import { redirect } from '@sveltejs/kit';
import { resolve } from '$app/paths';
import type { PageLoad } from './$types';

// Backward-compatibility redirect: /fuel-entry → /?capture=fuel
// Post-Story-3.3 the inline /log forms are retired and capture happens in the global sheet, so this
// legacy route lands on Home with the layout deep-link $effect opening the Capture sheet on Fuel.
// The `?capture=fuel` query survives the redirect; the layout strips it via replaceState after use.
export const load: PageLoad = () => {
	redirect(307, resolve('/') + '?capture=fuel');
};
