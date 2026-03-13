<script lang="ts">
	import ArrowUp from '@lucide/svelte/icons/arrow-up';
	import Download from '@lucide/svelte/icons/download';
	import Share2 from '@lucide/svelte/icons/share-2';
	import type { InstallPromptPlatform } from '$lib/utils/installPrompt';

	interface Props {
		platform: InstallPromptPlatform;
		canTriggerNativeInstall?: boolean;
		onInstall?: () => void | Promise<void>;
		onDismiss: () => void;
	}

	let {
		platform,
		canTriggerNativeInstall = false,
		onInstall = async () => {},
		onDismiss
	}: Props = $props();

	let isInstalling = $state(false);

	const isIos = $derived(platform === 'ios');
	const showAndroidInstall = $derived(platform === 'android' && canTriggerNativeInstall);

	async function handleInstall() {
		if (!showAndroidInstall || isInstalling) {
			return;
		}

		isInstalling = true;
		try {
			await onInstall();
		} finally {
			isInstalling = false;
		}
	}
</script>

{#if isIos || showAndroidInstall}
	<section
		role="complementary"
		aria-label="Install passanger on your home screen"
		class="rounded-[1.5rem] border border-border/80 bg-card px-4 py-4 shadow-sm"
	>
		<div class="mx-auto mb-3 h-1.5 w-12 rounded-full bg-border/80"></div>

		<div class="flex items-start gap-3">
			<div
				class="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-primary/10 text-primary"
				aria-hidden="true"
			>
				{#if isIos}
					<Share2 size={18} />
				{:else}
					<Download size={18} />
				{/if}
			</div>

			<div class="min-w-0 flex-1">
				<p class="text-sm font-semibold text-foreground">Keep passanger one tap away</p>
				<p class="mt-1 text-sm leading-6 text-muted-foreground">
					{#if isIos}
						Add it to your iPhone home screen so fill-up logging stays easy at the pump.
					{:else}
						Install it from your browser now for faster fuel logging next time.
					{/if}
				</p>
			</div>
		</div>

		{#if isIos}
			<div class="mt-4 rounded-[1.25rem] border border-border/70 bg-muted/70 px-4 py-4">
				<div class="flex items-center gap-2 text-sm font-medium text-foreground">
					<ArrowUp size={16} class="text-primary" aria-hidden="true" />
					<span>Look for Safari&apos;s Share button</span>
				</div>
				<p class="mt-3 text-sm text-muted-foreground">
					Tap the Share icon -&gt; select &quot;Add to Home Screen&quot;.
				</p>
				<div class="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
					<Share2 size={14} aria-hidden="true" />
					<span>Then return here whenever you need to log a fill-up.</span>
				</div>
			</div>

			<div class="mt-4 flex justify-end">
				<button
					type="button"
					class="rounded-full border border-border px-4 py-2 text-sm font-medium text-foreground hover:bg-muted"
					onclick={onDismiss}
				>
					Dismiss
				</button>
			</div>
		{:else}
			<div class="mt-4 flex flex-wrap items-center gap-3">
				<button
					type="button"
					class="min-h-11 rounded-full bg-accent px-4 py-2 text-sm font-semibold text-accent-foreground hover:bg-accent/90 disabled:cursor-not-allowed disabled:opacity-70"
					disabled={isInstalling}
					aria-busy={isInstalling}
					onclick={handleInstall}
				>
					{#if isInstalling}
						Opening install dialog...
					{:else}
						Install
					{/if}
				</button>
				<button
					type="button"
					class="rounded-full border border-border px-4 py-2 text-sm font-medium text-foreground hover:bg-muted"
					onclick={onDismiss}
				>
					Maybe later
				</button>
			</div>
		{/if}
	</section>
{/if}
