<script lang="ts">
	import { page } from '$app/state';
	import { resolve } from '$app/paths';
	import Fuel from '@lucide/svelte/icons/fuel';
	import ClipboardList from '@lucide/svelte/icons/clipboard-list';
	import BarChart3 from '@lucide/svelte/icons/bar-chart-3';
	import Download from '@lucide/svelte/icons/download';

	const tabs = [
		{ href: '/log', label: 'Log', icon: Fuel },
		{ href: '/history', label: 'History', icon: ClipboardList },
		{ href: '/analytics', label: 'Analytics', icon: BarChart3 },
		{ href: '/export', label: 'Export', icon: Download }
	] as const;

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
	{#each tabs as tab (tab.href)}
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
