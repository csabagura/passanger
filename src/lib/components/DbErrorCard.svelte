<script lang="ts">
	import { resolve } from '$app/paths';
	import type { Snippet } from 'svelte';

	// Shared "your data is safe — export it" card (H2). Understand/Maintain/History each hand-rolled
	// a near-identical version of this with their own i18n keys — this extracts the markup only.
	// `body` accepts either a plain string or a Snippet so a surface with more than one paragraph
	// (e.g. History's extra export hint) can render multiple lines without inventing a 4th prop or
	// renaming any surface's existing message keys.
	interface Props {
		title: string;
		body: string | Snippet;
		ctaLabel: string;
	}

	let { title, body, ctaLabel }: Props = $props();
</script>

<div role="alert" class="flex flex-col items-center justify-center gap-4 p-8 text-center">
	<p class="text-lg font-semibold text-foreground">{title}</p>
	<div class="space-y-1 text-sm text-muted-foreground">
		{#if typeof body === 'string'}
			<p>{body}</p>
		{:else}
			{@render body()}
		{/if}
	</div>
	<a
		href={resolve('/export')}
		class="rounded-xl bg-accent px-5 py-3 text-sm font-semibold text-accent-foreground"
	>
		{ctaLabel}
	</a>
</div>
