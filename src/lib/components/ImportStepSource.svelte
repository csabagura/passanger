<script lang="ts">
	import type { ImportSource } from '$lib/utils/importTypes';

	interface ImportStepSourceProps {
		onSourceSelected: (source: ImportSource) => void;
	}

	let { onSourceSelected }: ImportStepSourceProps = $props();

	const sources: { id: ImportSource; label: string; description: string }[] = [
		{ id: 'fuelly', label: 'Fuelly', description: 'Import from Fuelly CSV export' },
		{
			id: 'acar',
			label: 'aCar / Fuelio',
			description: 'Import from aCar or Fuelio CSV export'
		},
		{ id: 'drivvo', label: 'Drivvo', description: 'Import from Drivvo CSV export' },
		{ id: 'generic', label: 'Generic CSV', description: 'Import from any CSV file' }
	];
</script>

<div class="space-y-3">
	<p class="text-sm text-muted-foreground">
		Select the app you exported from. We'll use this to map your data correctly.
	</p>

	<div class="grid grid-cols-1 gap-3 md:grid-cols-2">
		{#each sources as source}
			<button
				type="button"
				class="flex min-h-12 flex-col items-start rounded-2xl border border-border bg-card p-4 text-left shadow-sm transition-colors hover:border-accent hover:bg-accent/5"
				aria-label="Import from {source.label}"
				onclick={() => onSourceSelected(source.id)}
			>
				<span class="text-base font-semibold text-foreground">{source.label}</span>
				<span class="mt-1 text-sm text-muted-foreground">{source.description}</span>
			</button>
		{/each}
	</div>
</div>
