<script lang="ts">
	import { registerSW } from 'virtual:pwa-register';
	import { UPDATE_PROMPT_BOTTOM_OFFSET } from '$lib/config';

	interface Props {
		onVisibilityChange?: (visible: boolean) => void;
	}

	let { onVisibilityChange = () => {} }: Props = $props();

	let needRefresh = $state(false);

	// registerSW called at component init (runs once) — returns the update trigger function
	// Using virtual:pwa-register (not /svelte version) to stay Svelte 5 Runes-native
	const updateSW = registerSW({
		onNeedRefresh() {
			needRefresh = true;
		},
		onOfflineReady() {
			// Silent — no offline banners; silence communicates reliability (architecture rule)
		}
	});

	$effect(() => {
		onVisibilityChange(needRefresh);
	});
</script>

{#if needRefresh}
	<div
		class="fixed left-0 right-0 z-50 flex items-center justify-between bg-primary px-4 py-3 text-primary-foreground shadow-lg"
		style={`bottom: ${UPDATE_PROMPT_BOTTOM_OFFSET};`}
		role="status"
		aria-live="polite"
	>
		<span class="text-sm font-medium">Update available</span>
		<button
			class="rounded-lg bg-primary-foreground px-3 py-1 text-sm font-medium text-primary hover:bg-secondary"
			onclick={() => updateSW(true)}
		>
			Reload
		</button>
	</div>
{/if}
