<script lang="ts">
	interface Props {
		ondismiss: () => void;
	}

	let { ondismiss }: Props = $props();
</script>

<!--
	Inline dismissible notice for storage-protection unavailability (AC3).
	- role="status" + aria-live="polite": polite live region — announced without stealing focus
	- Non-modal inline card pattern (no modals, no offline banners, no error screens)
	- Uses shared design tokens (bg-muted, text-muted-foreground, etc.) — no hard-coded colors
-->
<div class="mx-auto w-full px-4 py-2 lg:max-w-[480px]" role="status" aria-live="polite">
	<div
		class="flex items-start justify-between gap-3 rounded-lg border border-border bg-muted px-4 py-3 text-sm text-muted-foreground"
	>
		<p class="leading-snug">
			Storage protection unavailable on this browser - export your data regularly to prevent loss
		</p>
		<button
			class="shrink-0 rounded px-2 py-0.5 text-xs font-medium hover:bg-accent hover:text-accent-foreground"
			onclick={ondismiss}
			aria-label="Dismiss storage protection notice"
		>
			Dismiss
		</button>
	</div>
</div>
