<script lang="ts">
	import { setContext } from 'svelte';
	import SettingsContextConsumer from './SettingsContextConsumer.test.svelte';
	import type { AppSettings } from '$lib/utils/settings';

	const { initialSettings, onContextCreated } = $props<{
		initialSettings: AppSettings;
		onContextCreated?: (ctx: {
			settings: AppSettings;
			updateSettings: (s: AppSettings) => void;
		}) => void;
	}>();

	// Initialize settings state with captured copy of initialSettings
	const initSettings = () => ({ ...initialSettings });
	let settings = $state<AppSettings>(initSettings());

	const ctx = {
		get settings() {
			return settings;
		},
		updateSettings(s: AppSettings) {
			settings = s;
		}
	};

	setContext('settings', ctx);

	// Invoke callback if provided — capture in IIFE to avoid init-time reference warning
	(() => {
		onContextCreated?.(ctx);
	})();
</script>

<SettingsContextConsumer />
