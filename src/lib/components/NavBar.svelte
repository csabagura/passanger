<script lang="ts">
	import { page } from '$app/state';
	import { resolve } from '$app/paths';
	import House from '@lucide/svelte/icons/house';
	import BarChart3 from '@lucide/svelte/icons/bar-chart-3';
	import ClipboardList from '@lucide/svelte/icons/clipboard-list';
	import Wrench from '@lucide/svelte/icons/wrench';

	// DEC-1 bottom nav: Home · Understand · [FAB] · History · Maintain (UX-DR5). The centre slot is
	// the floating <Fab> (mounted by the layout, visually centred over the bar) — it is NOT a nav link,
	// so the bar renders four links with an empty centre spacer the FAB sits above.
	//
	// Interim targets (Story 3.3 Dev Notes §4, OQ-2/3): the /understand and /maintain route bodies are
	// Epic-4 work (Stories 4.4/4.5), so Understand points at the existing /analytics precursor and
	// Maintain at /settings (reminders live there today). No nav item may 404; both retarget in Epic 4.
	const tabs = [
		{ href: '/', label: 'Home', icon: House },
		{ href: '/analytics', label: 'Understand', icon: BarChart3 },
		{ href: '/history', label: 'History', icon: ClipboardList },
		{ href: '/settings', label: 'Maintain', icon: Wrench }
	] as const;

	// Index in `tabs` BEFORE which the centre FAB spacer is inserted (between Understand and History),
	// so the FAB lands dead-centre over a 5-column bar.
	const FAB_SLOT_INDEX = 2;

	const currentPath = $derived(page.url.pathname);

	function handleActiveTabClick(event: MouseEvent, tab: (typeof tabs)[number]) {
		const resolvedPath = resolve(tab.href);
		if (currentPath === resolvedPath) {
			event.preventDefault();
			window.scrollTo({ top: 0, behavior: 'instant' });
		}
	}

	function handleTabKeydown(event: KeyboardEvent) {
		const target = event.currentTarget as HTMLAnchorElement;
		const nav = target.closest('nav');
		if (!nav) return;

		const allLinks = Array.from(nav.querySelectorAll<HTMLAnchorElement>('a'));
		const currentIndex = allLinks.indexOf(target);
		let nextIndex: number | null = null;

		switch (event.key) {
			case ' ':
				event.preventDefault();
				target.click();
				return;
			case 'ArrowRight':
				nextIndex = (currentIndex + 1) % allLinks.length;
				break;
			case 'ArrowLeft':
				nextIndex = (currentIndex - 1 + allLinks.length) % allLinks.length;
				break;
			case 'Home':
				nextIndex = 0;
				break;
			case 'End':
				nextIndex = allLinks.length - 1;
				break;
			default:
				return;
		}

		if (nextIndex !== null) {
			event.preventDefault();
			allLinks[nextIndex].focus();
		}
	}
</script>

<nav
	class="fixed bottom-0 left-0 right-0 z-40 flex border-t border-border bg-card"
	style="padding-bottom: env(safe-area-inset-bottom);"
	aria-label="Main navigation"
>
	{#each tabs as tab, index (tab.href)}
		{#if index === FAB_SLOT_INDEX}
			<!-- Centre spacer reserving the column the floating <Fab> visually occupies (DEC-1). -->
			<div class="min-w-[44px] flex-1" aria-hidden="true"></div>
		{/if}
		{@const resolvedHref = resolve(tab.href)}
		{@const isActive = currentPath === resolvedHref}
		<a
			href={resolvedHref}
			aria-current={isActive ? 'page' : undefined}
			onclick={(event) => handleActiveTabClick(event, tab)}
			onkeydown={handleTabKeydown}
			class="flex min-h-[64px] min-w-[44px] flex-1 flex-col items-center justify-center gap-1 no-underline motion-safe:transition-transform motion-safe:duration-150 {isActive
				? 'text-accent'
				: 'text-text-disabled'}"
			class:active:scale-95={true}
		>
			<tab.icon size={24} aria-hidden="true" />
			<span class="text-xs font-medium">{tab.label}</span>
		</a>
	{/each}
</nav>
