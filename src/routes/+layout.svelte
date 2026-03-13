<script lang="ts">
	import '../app.css';
	import { setContext } from 'svelte';
	import UpdatePrompt from '$lib/components/UpdatePrompt.svelte';
	import NavBar from '$lib/components/NavBar.svelte';
	import StorageProtectionNotice from '$lib/components/StorageProtectionNotice.svelte';
	import { APP_SHELL_MAIN_PADDING, APP_SHELL_MAIN_PADDING_WITH_UPDATE_PROMPT } from '$lib/config';
	import { getSettings } from '$lib/utils/settings';
	import type { AppSettings } from '$lib/utils/settings';
	import {
		requestStoragePersistence,
		hasNoticeDismissed,
		markNoticeDismissed
	} from '$lib/utils/storagePersistence';
	import type { StoragePersistenceOutcome } from '$lib/utils/storagePersistence';
	import {
		getInstallPromptPlatform,
		hasInstallPromptBeenDismissed,
		isStandaloneDisplayMode,
		markInstallPromptDismissed
	} from '$lib/utils/installPrompt';
	import type {
		BeforeInstallPromptEvent,
		InstallPromptContext,
		InstallPromptPlatform,
		InstallPromptRequestOutcome
	} from '$lib/utils/installPrompt';

	let { children } = $props();

	let settings = $state<AppSettings>(getSettings());

	setContext('settings', {
		get settings() {
			return settings;
		},
		updateSettings(s: AppSettings) {
			settings = s;
		}
	});

	let installPromptPlatform = $state<InstallPromptPlatform>('unsupported');
	let installPromptStandalone = $state(false);
	let installPromptCompleted = $state(false);
	let installPromptPersistedDismissed = $state(false);
	let installPromptSessionDismissed = $state(false);
	let deferredInstallPrompt = $state<BeforeInstallPromptEvent | null>(null);

	function isInstallPromptDismissed(): boolean {
		return (
			installPromptCompleted || installPromptPersistedDismissed || installPromptSessionDismissed
		);
	}

	function canShowInstallPrompt(): boolean {
		if (installPromptStandalone || isInstallPromptDismissed()) {
			return false;
		}

		if (installPromptPlatform === 'ios') {
			return true;
		}

		return installPromptPlatform === 'android' && deferredInstallPrompt !== null;
	}

	function dismissInstallPrompt(): void {
		installPromptSessionDismissed = true;
		installPromptPersistedDismissed = true;
		markInstallPromptDismissed();
	}

	async function requestInstall(): Promise<InstallPromptRequestOutcome> {
		if (!deferredInstallPrompt) {
			return 'unavailable';
		}

		const promptEvent = deferredInstallPrompt;
		deferredInstallPrompt = null;
		installPromptSessionDismissed = true;

		try {
			await promptEvent.prompt();
			const userChoice = await promptEvent.userChoice;
			return userChoice.outcome;
		} catch {
			return 'unavailable';
		}
	}

	const installPromptContext: InstallPromptContext = {
		get platform() {
			return installPromptPlatform;
		},
		get isStandalone() {
			return installPromptStandalone;
		},
		get isDismissed() {
			return isInstallPromptDismissed();
		},
		get canShowPrompt() {
			return canShowInstallPrompt();
		},
		get canTriggerNativeInstall() {
			return installPromptPlatform === 'android' && deferredInstallPrompt !== null;
		},
		dismissPrompt() {
			dismissInstallPrompt();
		},
		requestInstall() {
			return requestInstall();
		}
	};

	setContext('installPrompt', installPromptContext);

	// Storage protection — only runs in browser window context (Task 1.4)
	let storageOutcome = $state<StoragePersistenceOutcome | null>(null);
	let noticeDismissed = $state(false);
	let updatePromptVisible = $state(false);
	let mainBottomPadding = $derived(
		updatePromptVisible ? APP_SHELL_MAIN_PADDING_WITH_UPDATE_PROMPT : APP_SHELL_MAIN_PADDING
	);

	$effect(() => {
		if (typeof window === 'undefined') return;

		// Read dismissal state synchronously before awaiting (so UI doesn't flash)
		noticeDismissed = hasNoticeDismissed();
		installPromptPlatform = getInstallPromptPlatform(window.navigator);
		installPromptPersistedDismissed = hasInstallPromptBeenDismissed();
		installPromptStandalone = isStandaloneDisplayMode(window);

		const displayModeQuery =
			typeof window.matchMedia === 'function'
				? window.matchMedia('(display-mode: standalone)')
				: null;
		const syncDisplayMode = () => {
			installPromptStandalone = displayModeQuery?.matches ?? false;
			if (displayModeQuery?.matches) {
				installPromptCompleted = true;
				deferredInstallPrompt = null;
			}
		};
		const handleBeforeInstallPrompt = (event: Event) => {
			const promptEvent = event as BeforeInstallPromptEvent;
			promptEvent.preventDefault();
			deferredInstallPrompt = promptEvent;
		};
		const handleAppInstalled = () => {
			installPromptCompleted = true;
			installPromptSessionDismissed = true;
			deferredInstallPrompt = null;
		};

		syncDisplayMode();

		if (displayModeQuery) {
			if (typeof displayModeQuery.addEventListener === 'function') {
				displayModeQuery.addEventListener('change', syncDisplayMode);
			} else {
				displayModeQuery.addListener(syncDisplayMode);
			}
		}

		window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
		window.addEventListener('appinstalled', handleAppInstalled);

		requestStoragePersistence().then((outcome) => {
			storageOutcome = outcome;
		});

		return () => {
			if (displayModeQuery) {
				if (typeof displayModeQuery.removeEventListener === 'function') {
					displayModeQuery.removeEventListener('change', syncDisplayMode);
				} else {
					displayModeQuery.removeListener(syncDisplayMode);
				}
			}

			window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
			window.removeEventListener('appinstalled', handleAppInstalled);
		};
	});

	function handleNoticeDismiss() {
		markNoticeDismissed();
		noticeDismissed = true;
	}

	// Show notice when outcome is denied/unavailable and user hasn't dismissed it
	let showNotice = $derived(
		storageOutcome !== null && storageOutcome !== 'granted' && !noticeDismissed
	);
</script>

<svelte:head>
	<title>passanger</title>
</svelte:head>

<UpdatePrompt onVisibilityChange={(visible) => (updatePromptVisible = visible)} />
<main class="min-h-screen" style={`padding-bottom: ${mainBottomPadding};`}>
	{#if showNotice}
		<StorageProtectionNotice ondismiss={handleNoticeDismiss} />
	{/if}
	<div class="mx-auto w-full lg:max-w-[480px]">
		{@render children()}
	</div>
</main>
<NavBar />
