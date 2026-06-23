import { redirect } from '@sveltejs/kit';
import { resolve } from '$app/paths';
import type { PageLoad } from './$types';

// Backward-compatibility redirect: /maintenance → /?capture=expense
// Post-Story-3.3 capture happens in the global sheet (DEC-5: the "maintenance" entity surfaces as the
// "Expense" segment), so this legacy route lands on Home with the layout deep-link $effect opening the
// Capture sheet on Expense. The `?capture=expense` query survives the redirect; the layout strips it.
export const load: PageLoad = () => {
	redirect(307, resolve('/') + '?capture=expense');
};
