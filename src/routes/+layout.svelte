<script lang="ts">
	import '../app.css';
	import { setContext } from 'svelte';
	import UpdatePrompt from '$lib/components/UpdatePrompt.svelte';
	import AppHeader from '$lib/components/AppHeader.svelte';
	import NavBar from '$lib/components/NavBar.svelte';
	import StorageProtectionNotice from '$lib/components/StorageProtectionNotice.svelte';
	import {
		APP_SHELL_MAIN_PADDING,
		APP_SHELL_MAIN_PADDING_WITH_UPDATE_PROMPT,
		VEHICLE_ID_STORAGE_KEY
	} from '$lib/config';
	import { getAllVehicles } from '$lib/db/repositories/vehicles';
	import type { Vehicle } from '$lib/db/schema';
	import { readStoredVehicleId, safeSetItem } from '$lib/utils/vehicleStorage';
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
		incrementSessionCount,
		isSecondOrLaterSession,
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

	// Vehicle context — shared active vehicle state for all pages
	let vehicles = $state<Vehicle[]>([]);
	let activeVehicleId = $state<number | null>(null);
	let vehiclesLoaded = $state(false);
	let activeVehicle = $derived(
		activeVehicleId !== null ? (vehicles.find((v) => v.id === activeVehicleId) ?? null) : null
	);

	async function loadVehicles() {
		const result = await getAllVehicles();
		if (!result.error) {
			vehicles = result.data;
		}
		vehiclesLoaded = true;
	}

	function switchVehicle(id: number) {
		activeVehicleId = id;
		safeSetItem(VEHICLE_ID_STORAGE_KEY, String(id));
	}

	async function refreshVehicles() {
		await loadVehicles();
	}

	$effect(() => {
		activeVehicleId = readStoredVehicleId();
		loadVehicles();
	});

	setContext('vehicles', {
		get vehicles() {
			return vehicles;
		},
		get activeVehicle() {
			return activeVehicle;
		},
		get activeVehicleId() {
			return activeVehicleId;
		},
		get loaded() {
			return vehiclesLoaded;
		},
		switchVehicle,
		refreshVehicles
	});

	// Theme: toggle .dark class on <html> based on settings.theme
	$effect(() => {
		const theme = settings.theme;
		const prefersDark =
			typeof window.matchMedia === 'function'
				? window.matchMedia('(prefers-color-scheme: dark)')
				: null;

		const shouldBeDark =
			theme === 'dark' || (theme === 'system' && (prefersDark?.matches ?? false));
		document.documentElement.classList.toggle('dark', shouldBeDark);

		if (theme === 'system' && prefersDark) {
			const onSystemChange = () => {
				document.documentElement.classList.toggle('dark', prefersDark.matches);
			};
			prefersDark.addEventListener('change', onSystemChange);
			return () => prefersDark.removeEventListener('change', onSystemChange);
		}
	});

	let installPromptSessionEligible = $state(false);
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
		if (!installPromptSessionEligible) {
			return false;
		}

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

		// Session tracking for install prompt timing (FR40)
		incrementSessionCount();
		installPromptSessionEligible = isSecondOrLaterSession();

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
<AppHeader />
<main class="min-h-screen" style={`padding-bottom: ${mainBottomPadding};`}>
	{#if showNotice}
		<StorageProtectionNotice ondismiss={handleNoticeDismiss} />
	{/if}
	<div class="mx-auto w-full lg:max-w-[480px]">
		{@render children()}
	</div>
</main>
<NavBar />
