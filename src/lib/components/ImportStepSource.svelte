<script lang="ts">
	import type { ImportSource } from '$lib/utils/importTypes';
	import { m } from '$lib/paraglide/messages';

	interface ImportStepSourceProps {
		onSourceSelected: (source: ImportSource) => void;
	}

	let { onSourceSelected }: ImportStepSourceProps = $props();

	// `label` holds brand/format names (Fuelly, Drivvo, aCar, Fuelio) which are NOT translated; only
	// the "Generic CSV" label and the descriptions/aria carry translatable copy.
	const sources: { id: ImportSource; label: string; description: string }[] = [
		{ id: 'fuelly', label: 'Fuelly', description: m.import_source_fuelly_desc() },
		{
			id: 'acar',
			label: 'aCar / Fuelio',
			description: m.import_source_acar_desc()
		},
		{ id: 'drivvo', label: 'Drivvo', description: m.import_source_drivvo_desc() },
		{
			id: 'generic',
			label: m.import_source_generic_label(),
			description: m.import_source_generic_desc()
		}
	];
</script>

<div class="space-y-3">
	<p class="text-sm text-muted-foreground">
		{m.import_source_intro()}
	</p>

	<div class="grid grid-cols-1 gap-3 md:grid-cols-2">
		{#each sources as source (source.id)}
			<button
				type="button"
				class="flex min-h-12 flex-col items-start rounded-2xl border border-border bg-card p-4 text-left shadow-sm transition-colors hover:border-accent hover:bg-accent/5"
				aria-label={m.import_source_card_label({ source: source.label })}
				onclick={() => onSourceSelected(source.id)}
			>
				<span class="text-base font-semibold text-foreground">{source.label}</span>
				<span class="mt-1 text-sm text-muted-foreground">{source.description}</span>
			</button>
		{/each}
	</div>
</div>
