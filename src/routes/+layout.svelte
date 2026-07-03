<script lang="ts">
	import '../app.css';
	import { setContext } from 'svelte';
	import { page } from '$app/state';
	import { replaceState, afterNavigate } from '$app/navigation';
	import UpdatePrompt from '$lib/components/UpdatePrompt.svelte';
	import AppHeader from '$lib/components/AppHeader.svelte';
	import NavBar from '$lib/components/NavBar.svelte';
	import Fab from '$lib/components/Fab.svelte';
	import CaptureSheet from '$lib/components/capture/CaptureSheet.svelte';
	import { createCaptureSheet } from '$lib/state/captureSheet.svelte';
	import { consumeCaptureDeepLink } from '$lib/state/captureDeepLink';
	import StorageProtectionNotice from '$lib/components/StorageProtectionNotice.svelte';
	import TabSyncNotice from '$lib/components/TabSyncNotice.svelte';
	import InstallPrompt from '$lib/components/InstallPrompt.svelte';
	import OnboardingSurvey from '$lib/components/OnboardingSurvey.svelte';
	import {
		shouldShowOnboardingSurvey,
		saveOnboardingSurveyResponse,
		dismissOnboardingSurvey
	} from '$lib/utils/onboardingSurvey';
	import type { OnboardingSurveyResponse } from '$lib/utils/onboardingSurvey';
	import { Toaster } from '$lib/components/ui/sonner';
	import { m } from '$lib/paraglide/messages';
	import { toast } from '$lib/state/toast';
	import {
		APP_SHELL_MAIN_PADDING,
		APP_SHELL_MAIN_PADDING_WITH_UPDATE_PROMPT,
		TAB_SYNC_CUE_DURATION_MS,
		VEHICLE_ID_STORAGE_KEY
	} from '$lib/config';
	import { getAllVehicles } from '$lib/db/repositories/vehicles';
	import { offerReminderReset } from '$lib/utils/reminderResetOffer';
	import type { Vehicle, Expense } from '$lib/db/schema';
	import { readStoredVehicleId, safeSetItem } from '$lib/utils/vehicleStorage';
	import { getSettings } from '$lib/utils/settings';
	import type { AppSettings } from '$lib/utils/settings';
	import { subscribeTabSync } from '$lib/utils/tabSync';
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

	// AD-2/AD-4b: the single toast+undo channel, mounted once below and shared via context
	// (string key 'toast', matching the existing settings/vehicles convention). No state library.
	setContext('toast', toast);

	// AD-3/AD-4b: the global Capture sheet state, provided once here and consumed by <Fab>, the
	// <CaptureSheet> (both mounted below), and the deep-link $effect. String key 'captureSheet'.
	const captureSheet = createCaptureSheet();
	setContext('captureSheet', captureSheet);

	// `?capture=fuel|expense` deep link: open the sheet on the matching segment, then strip the param
	// via replaceState so closing / reload / back doesn't re-trigger it and the URL reflects real state.
	// Route-agnostic (reads the current URL). Story 3.3: the legacy /log, /fuel-entry and /maintenance
	// redirects land here with `?capture=…` on a COLD load. This MUST run via afterNavigate, not a bare
	// $effect — `replaceState` called during the initial hydration flush crashes (the SvelteKit client
	// router isn't initialized yet → `$set` of undefined and a blank app). afterNavigate fires after the
	// router is ready, on the initial load AND every subsequent navigation, so cold-load redirects and
	// warm `?capture=` link clicks both consume safely. (The shallow replaceState strip does not itself
	// re-trigger afterNavigate, so there is no loop.)
	afterNavigate(() => {
		consumeCaptureDeepLink(page.url, captureSheet, (cleaned) =>
			// eslint-disable-next-line svelte/no-navigation-without-resolve -- `cleaned` is the current page.url with the `capture` query param removed; it is already base-path-resolved, so resolve() does not apply.
			replaceState(cleaned, page.state)
		);
	});

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

	// Multi-tab safety: a write / settings change / restore in ANOTHER tab posts a BroadcastChannel
	// message; here we re-run the existing imperative loads so this tab reconciles. `dataRevision` is
	// the reactive trigger that History reads inside its load $effect. (Understand uses liveQuery for
	// cross-surface reactivity instead, so it does not depend on dataRevision — Story 4.4 / AD-4.)
	let dataRevision = $state(0);
	let remoteCue = $state<'data' | 'settings' | null>(null);
	let remoteRestorePending = $state(false);
	let cueTimer: ReturnType<typeof setTimeout> | null = null;

	function showRemoteCue(kind: 'data' | 'settings') {
		remoteCue = kind;
		if (cueTimer) clearTimeout(cueTimer);
		cueTimer = setTimeout(() => {
			remoteCue = null;
			cueTimer = null;
		}, TAB_SYNC_CUE_DURATION_MS);
	}

	setContext('tabSync', {
		get dataRevision() {
			return dataRevision;
		},
		// ADR-006 AD-WB-4 (H17c): the History load $effect treats `dataRevision` as its multi-tab
		// reload signal. Bumping it to disarm a pending Undo would ALSO fire that reload — silently
		// swapping this tab's stale-but-intentionally-displayed list for the restored data before the
		// user clicks Reload, which is exactly the swap this feature exists to prevent. Consumers that
		// reload on `dataRevision` must additionally check this flag and skip the reload while it's true.
		get restorePending() {
			return remoteRestorePending;
		}
	});

	$effect(() => {
		const unsubscribe = subscribeTabSync((message) => {
			// Once a remote restore is pending, this tab's view is stale until the user reloads — ignore
			// further data/settings signals so we never silently refetch/swap under the reload prompt.
			if (remoteRestorePending) return;
			if (message.kind === 'restore') {
				// The whole DB was replaced elsewhere — never silently swap this tab's now-orphaned rows.
				remoteRestorePending = true;
				// ADR-006 AD-WB-4 (H17c): bump dataRevision so a pending Undo's generation guard
				// (history/+page.svelte) sees a change and refuses — otherwise it could re-insert a
				// pre-restore snapshot into the freshly restored DB. The restoring tab's own pending
				// Undo is already safe via its location.reload(); this closes the RECEIVING tab's gap.
				dataRevision++;
				return;
			}
			if (message.kind === 'settings') {
				settings = getSettings();
				showRemoteCue('settings');
				return;
			}
			// 'data' — refetch live data (revision bump) and refresh the shared vehicle list.
			dataRevision++;
			void refreshVehicles();
			showRemoteCue('data');
		});

		return () => {
			unsubscribe();
			if (cueTimer) clearTimeout(cueTimer);
		};
	});

	// Theme: track the OS color-scheme as reactive state so BOTH the <html>.dark class and the
	// <Toaster theme> (Story 2.4 AC-8) react to a live system-theme change, not just the .dark class.
	let systemPrefersDark = $state(
		typeof window !== 'undefined' && typeof window.matchMedia === 'function'
			? window.matchMedia('(prefers-color-scheme: dark)').matches
			: false
	);

	// AC-8: the resolved theme ('dark' | 'light') is passed to <Toaster>, overriding the inert
	// `theme={mode.current}` mode-watcher binding in ui/sonner (no <ModeWatcher> is mounted), so a
	// raised error toast renders in the app's actual theme.
	const resolvedTheme = $derived<'dark' | 'light'>(
		settings.theme === 'dark' || (settings.theme === 'system' && systemPrefersDark)
			? 'dark'
			: 'light'
	);

	// Toggle <html>.dark AND keep systemPrefersDark in sync. The class is toggled imperatively (not
	// derived) so an OS-preference 'change' event updates it synchronously, without waiting for a
	// reactive flush; the same handler also updates systemPrefersDark so <Toaster theme> reacts.
	$effect(() => {
		const theme = settings.theme;
		const prefersDark =
			typeof window.matchMedia === 'function'
				? window.matchMedia('(prefers-color-scheme: dark)')
				: null;
		systemPrefersDark = prefersDark?.matches ?? false;

		const shouldBeDark =
			theme === 'dark' || (theme === 'system' && (prefersDark?.matches ?? false));
		document.documentElement.classList.toggle('dark', shouldBeDark);

		if (theme === 'system' && prefersDark) {
			const onSystemChange = () => {
				systemPrefersDark = prefersDark.matches;
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

	// Story 3.3 (AC-7): first-Capture → install-prompt / onboarding-survey gate (FR40). Pre-3.3 the
	// retired /log inline forms owned this via their `onFirstCreateSave`. Capture now happens in the
	// global sheet, so the layout owns the gate: <CaptureSheet> forwards each form's first-create-save
	// here, and the prompt/survey render in the main flow (the sheet has closed by the time they show).
	let firstSuccessfulCreateSave = $state(false);
	let installPromptHiddenByInteraction = $state(false);
	let onboardingSurveyEligible = $state(shouldShowOnboardingSurvey());

	const showInstallPrompt = $derived(
		firstSuccessfulCreateSave &&
			!installPromptHiddenByInteraction &&
			installPromptContext.canShowPrompt
	);
	const showOnboardingSurvey = $derived(
		firstSuccessfulCreateSave && !showInstallPrompt && onboardingSurveyEligible
	);

	function handleFirstCreateSave() {
		firstSuccessfulCreateSave = true;
		installPromptHiddenByInteraction = false;
	}

	// Story 4.6 (FR-12 loop-close / DEC-6): when an Expense whose `type` token-matches a reminder
	// `title` is created, OFFER (confirm, never auto) to reset that reminder's last-service marker.
	// Layout-owned wiring (mirrors the install/survey gate): CaptureSheet forwards the expense form's
	// create-only save here; the offer logic lives in reminderResetOffer.ts and rides the shared
	// `toast` channel. The common path (no match) is silent. Confirming writes via the repo, whose
	// notifyDataChanged() re-emits the Home Up-Next + /maintain liveQuery to recompute status to `ok`.
	function handleExpenseCreateSave(expense: Expense) {
		// onApplied bumps the same-tab dataRevision so the Home Up-Next card re-reads and recomputes the
		// reset reminder's status to `ok` immediately (AC5) — the repo's notifyDataChanged only reaches
		// other tabs (a BroadcastChannel never self-delivers).
		void offerReminderReset(expense, toast, {
			onApplied: () => {
				dataRevision += 1;
			}
		});
	}

	function handleSurveySubmit(response: OnboardingSurveyResponse) {
		saveOnboardingSurveyResponse(response);
		onboardingSurveyEligible = false;
	}

	function handleSurveyDismiss() {
		dismissOnboardingSurvey();
		onboardingSurveyEligible = false;
	}

	function handleInstallPromptDismiss() {
		installPromptHiddenByInteraction = true;
		firstSuccessfulCreateSave = false;
		installPromptContext.dismissPrompt();
	}

	async function handleInstallPromptInstall() {
		installPromptHiddenByInteraction = true;
		firstSuccessfulCreateSave = false;
		await installPromptContext.requestInstall();
	}

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

<a
	href="#main-content"
	class="sr-only rounded-md bg-card px-4 py-2 text-foreground focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
>
	{m.skip_to_content()}
</a>
<UpdatePrompt onVisibilityChange={(visible) => (updatePromptVisible = visible)} />
<TabSyncNotice
	cue={remoteCue}
	restorePending={remoteRestorePending}
	onReload={() => location.reload()}
/>
<AppHeader />
<main
	id="main-content"
	tabindex="-1"
	class="min-h-screen focus:outline-none"
	style={`padding-bottom: ${mainBottomPadding};`}
>
	{#if showNotice}
		<StorageProtectionNotice ondismiss={handleNoticeDismiss} />
	{/if}
	<div class="mx-auto w-full lg:max-w-[480px]">
		{@render children()}
		{#if showInstallPrompt}
			<!-- Story 3.3 (AC-7): shown after the first successful Capture, once the sheet has closed. -->
			<div class="px-4 pb-4">
				<InstallPrompt
					platform={installPromptContext.platform}
					canTriggerNativeInstall={installPromptContext.canTriggerNativeInstall}
					onInstall={handleInstallPromptInstall}
					onDismiss={handleInstallPromptDismiss}
				/>
			</div>
		{/if}
		{#if showOnboardingSurvey}
			<div class="px-4 pb-4">
				<OnboardingSurvey onSubmit={handleSurveySubmit} onDismiss={handleSurveyDismiss} />
			</div>
		{/if}
	</div>
</main>
<NavBar />
<Fab />
<CaptureSheet onFirstCreateSave={handleFirstCreateSave} onCreateSave={handleExpenseCreateSave} />
<Toaster theme={resolvedTheme} />
