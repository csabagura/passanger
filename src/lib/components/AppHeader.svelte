<script lang="ts">
	import { page } from '$app/state';
	import { resolve } from '$app/paths';
	import SettingsIcon from '@lucide/svelte/icons/settings';
	import VehicleSwitcher from '$lib/components/VehicleSwitcher.svelte';

	const resolvedTitles: Array<[string, string]> = [
		[resolve('/log'), 'Log'],
		[resolve('/history'), 'History'],
		[resolve('/analytics'), 'Analytics'],
		[resolve('/export'), 'Export'],
		[resolve('/settings'), 'Settings']
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
	aria-label="App header"
>
	<VehicleSwitcher />

	<h1 class="text-base font-semibold text-foreground">{screenTitle}</h1>

	<a
		href={settingsHref}
		aria-label="Settings"
		aria-current={isSettingsActive ? 'page' : undefined}
		class="inline-flex h-11 w-11 items-center justify-center rounded-full text-muted-foreground transition-colors hover:text-foreground {isSettingsActive
			? 'text-accent'
			: ''}"
	>
		<SettingsIcon size={20} aria-hidden="true" />
	</a>
</header>
