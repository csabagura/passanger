<script lang="ts">
	import { getContext } from 'svelte';
	import type { InstallPromptContext } from '$lib/utils/installPrompt';

	const ctx = getContext<InstallPromptContext>('installPrompt');
	let lastResult = $state('');

	async function handleRequestInstall() {
		lastResult = await ctx.requestInstall();
	}
</script>

<span data-testid="install-platform">{ctx.platform}</span>
<span data-testid="install-standalone">{String(ctx.isStandalone)}</span>
<span data-testid="install-dismissed">{String(ctx.isDismissed)}</span>
<span data-testid="install-can-show">{String(ctx.canShowPrompt)}</span>
<span data-testid="install-can-trigger">{String(ctx.canTriggerNativeInstall)}</span>
<span data-testid="install-result">{lastResult}</span>

<button type="button" onclick={ctx.dismissPrompt}>Dismiss install prompt</button>
<button type="button" onclick={handleRequestInstall}>Prompt install</button>
