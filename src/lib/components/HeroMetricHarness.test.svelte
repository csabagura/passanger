<script lang="ts">
	// Reactive 'settings' context harness for HeroMetric (mirrors SettingsContextProvider.test.svelte):
	// updateSettings writes a real $state so a toggle actually re-derives the displayed metric, exactly
	// like the layout provider does in the app.
	import { setContext } from 'svelte';
	import HeroMetric from './HeroMetric.svelte';
	import type { AppSettings } from '$lib/utils/settings';
	import type { FuelLog } from '$lib/db/schema';

	const { initialSettings, fuelLogs } = $props<{
		initialSettings: AppSettings;
		fuelLogs: FuelLog[];
	}>();

	// Capture-in-a-factory to avoid the state_referenced_locally init warning (mirrors
	// SettingsContextProvider.test.svelte).
	const initSettings = () => ({ ...initialSettings });
	let settings = $state<AppSettings>(initSettings());

	setContext('settings', {
		get settings() {
			return settings;
		},
		updateSettings(s: AppSettings) {
			settings = s;
		}
	});
</script>

<HeroMetric {fuelLogs} />
