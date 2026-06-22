<script lang="ts">
	// Story 2.2 (FR-4 / AC-2): one-tap recent-currency chips next to the currency <select>.
	// Dumb + presentational — no store/context reads — so both forms (Fuel, Expense) can mount
	// it and it stays trivially testable. The parent filters out the currently-selected value
	// and passes the remaining recents; an empty list renders nothing (the <select> suffices).
	interface Props {
		recent: string[];
		selected: string;
		onpick: (currency: string) => void;
	}

	let { recent, selected, onpick }: Props = $props();

	// Defensive: never show a chip for the value already selected (road-trip convenience is
	// about switching, not re-picking the current one).
	const chips = $derived(recent.filter((currency) => currency !== selected));
</script>

{#if chips.length > 0}
	<div class="mt-2 flex flex-wrap gap-2" role="group" aria-label="Recent currencies">
		{#each chips as currency (currency)}
			<button
				type="button"
				onclick={() => onpick(currency)}
				class="flex h-11 min-w-11 items-center justify-center rounded-lg border border-border bg-card px-3 text-base font-medium text-foreground outline-none hover:bg-muted focus:ring-2 focus:ring-ring"
			>
				{currency}
			</button>
		{/each}
	</div>
{/if}
