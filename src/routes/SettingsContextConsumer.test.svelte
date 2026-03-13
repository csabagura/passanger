<script lang="ts">
	import { getContext } from 'svelte';

	const ctx = getContext<{
		settings: { fuelUnit: string; currency: string };
		updateSettings: (s: { fuelUnit: string; currency: string }) => void;
	}>('settings');
</script>

<span data-testid="fuel-unit">{ctx.settings.fuelUnit}</span>
<span data-testid="currency">{ctx.settings.currency}</span>
