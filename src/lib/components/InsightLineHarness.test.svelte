<script lang="ts">
	// Reactive 'settings' context harness for InsightLine (mirrors HeroMetricHarness.test.svelte):
	// provides a real $state-backed settings context exactly like the layout provider does.
	import { setContext } from 'svelte';
	import InsightLine from './InsightLine.svelte';
	import type { AppSettings } from '$lib/utils/settings';
	import type { Expense, FuelLog } from '$lib/db/schema';

	const { initialSettings, fuelLogs, expenses, now } = $props<{
		initialSettings: AppSettings;
		fuelLogs: FuelLog[];
		expenses: Expense[];
		now?: Date;
	}>();

	// Capture-in-a-factory to avoid the state_referenced_locally init warning.
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

<InsightLine {fuelLogs} {expenses} {now} />
