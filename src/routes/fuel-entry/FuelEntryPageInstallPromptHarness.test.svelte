<script lang="ts">
	import { setContext } from 'svelte';
	import FuelEntryPage from './+page.svelte';
	import type {
		InstallPromptContext,
		InstallPromptPlatform,
		InstallPromptRequestOutcome
	} from '$lib/utils/installPrompt';

	interface Props {
		platform?: InstallPromptPlatform;
		isStandalone?: boolean;
		isDismissed?: boolean;
		canShowPrompt?: boolean;
		canTriggerNativeInstall?: boolean;
		onDismissPrompt?: () => void;
		onRequestInstall?: () => Promise<InstallPromptRequestOutcome>;
	}

	let {
		platform = 'unsupported',
		isStandalone = false,
		isDismissed = false,
		canShowPrompt = false,
		canTriggerNativeInstall = false,
		onDismissPrompt = () => {},
		onRequestInstall = async () => 'unavailable'
	}: Props = $props();

	setContext('settings', {
		get settings() {
			return {
				fuelUnit: 'L/100km' as const,
				currency: '€' as const
			};
		}
	});

	const installPromptContext: InstallPromptContext = {
		get platform() {
			return platform;
		},
		get isStandalone() {
			return isStandalone;
		},
		get isDismissed() {
			return isDismissed;
		},
		get canShowPrompt() {
			return canShowPrompt;
		},
		get canTriggerNativeInstall() {
			return canTriggerNativeInstall;
		},
		dismissPrompt() {
			onDismissPrompt();
		},
		requestInstall() {
			return onRequestInstall();
		}
	};

	setContext('installPrompt', installPromptContext);
</script>

<FuelEntryPage />
