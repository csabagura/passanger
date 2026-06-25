<script lang="ts">
	import { page } from '$app/state';
	import { resolve } from '$app/paths';
	import SettingsIcon from '@lucide/svelte/icons/settings';
	import VehicleSwitcher from '$lib/components/VehicleSwitcher.svelte';
	import { m } from '$lib/paraglide/messages';

	// Story 3.3: `/` is Home (the default surface); `/log` is retired (redirects to the Capture sheet).
	// Story 4.4: Understand → /understand (the /analytics precursor redirects there). Story 4.5: Maintain
	// → /maintain (its own surface). /settings stays a route (the gear link below) and keeps its title.
	const resolvedTitles: Array<[string, string]> = [
		[resolve('/'), m.nav_home()],
		[resolve('/history'), m.nav_history()],
		[resolve('/understand'), m.nav_understand()],
		[resolve('/maintain'), m.nav_maintain()],
		[resolve('/export'), m.appheader_title_export()],
		[resolve('/settings'), m.settings_title()]
	];

	const currentPath = $derived(page.url.pathname);
	const settingsHref = $derived(resolve('/settings'));
	const isSettingsActive = $derived(currentPath === settingsHref);

	const screenTitle = $derived.by(() => {
		for (const [resolvedPath, title] of resolvedTitles) {
			if (currentPath === resolvedPath) {
				return title;
			}
		}
		return 'passanger';
	});
</script>

<header
	class="flex h-14 items-center justify-between border-b border-border bg-card px-4"
	aria-label={m.appheader_landmark()}
>
	<VehicleSwitcher />

	<h1 class="text-base font-semibold text-foreground">{screenTitle}</h1>

	<a
		href={resolve('/settings')}
		aria-label={m.settings_title()}
		aria-current={isSettingsActive ? 'page' : undefined}
		class="inline-flex h-11 w-11 items-center justify-center rounded-full text-muted-foreground transition-colors hover:text-foreground {isSettingsActive
			? 'text-accent'
			: ''}"
	>
		<SettingsIcon size={20} aria-hidden="true" />
	</a>
</header>
