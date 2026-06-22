<script lang="ts">
	import { getContext } from 'svelte';
	import { PRESET_CURRENCIES, SUPPORTED_UNITS, IMPORT_FILE_SIZE_MAX_BYTES } from '$lib/config';
	import { saveSettings, type AppSettings, type ThemePreference } from '$lib/utils/settings';
	import { notifySettingsChanged, notifyTabsRestored } from '$lib/utils/tabSync';
	import { readStoredVehicleId } from '$lib/utils/vehicleStorage';
	import { getAllFuelLogs } from '$lib/db/repositories/fuelLogs';
	import { exportAllTables, restoreAllTables, type BackupData } from '$lib/db/backup';
	import {
		serializeBackup,
		parseBackup,
		downloadBackupFile,
		buildBackupFilename
	} from '$lib/utils/backup';
	import type { VehiclesContext } from '$lib/utils/vehicleContext';
	import VehicleListManager from '$lib/components/VehicleListManager.svelte';
	import ServiceReminderManager from '$lib/components/ServiceReminderManager.svelte';
	import { Button } from '$lib/components/ui/button';
	import { Field } from '$lib/components/ui/field';

	let activeVehicleId = $state<number | null>(readStoredVehicleId());

	function handleActiveVehicleChange(id: number | null) {
		activeVehicleId = id;
	}

	const vehiclesCtx = getContext<VehiclesContext>('vehicles');
	const activeVehicle = $derived(vehiclesCtx?.activeVehicle ?? null);

	// Current odometer for the active vehicle = max odometer across its fuel logs.
	let currentOdometer = $state<number | undefined>(undefined);

	$effect(() => {
		const vehicle = activeVehicle;
		if (!vehicle) {
			currentOdometer = undefined;
			return;
		}
		let cancelled = false;
		(async () => {
			const result = await getAllFuelLogs(vehicle.id);
			if (cancelled) return;
			if (result.error || result.data.length === 0) {
				currentOdometer = undefined;
				return;
			}
			currentOdometer = result.data.reduce((max, log) => Math.max(max, log.odometer), 0);
		})();
		return () => {
			cancelled = true;
		};
	});

	const THEME_OPTIONS: { value: ThemePreference; label: string; description: string }[] = [
		{ value: 'system', label: 'System', description: 'Follows your device setting' },
		{ value: 'light', label: 'Light', description: 'Always light' },
		{ value: 'dark', label: 'Dark', description: 'Always dark' }
	];

	let settingsFuelUnit = $state<AppSettings['fuelUnit']>('L/100km');
	let settingsCurrency = $state('');
	let currencyError = $state('');
	let settingsStatusMessage = $state('');
	let settingsErrorMessage = $state('');
	let initialized = $state(false);
	// Exchange-rate drafts kept as strings (inputs may be blank/partial). Sanitised to finite
	// > 0 numbers on save; blank/0/negative entries are dropped from settings.exchangeRates.
	let exchangeRateDrafts = $state<Record<string, string>>({});

	const settingsCtx = getContext<{
		settings: AppSettings;
		updateSettings: (settings: AppSettings) => void;
	}>('settings');

	const fuelUnitHelpId = 'settings-fuel-unit-help';
	const currencyHelpId = 'settings-currency-help';

	// Currencies offered for a rate: non-home presets plus any currency already saved with a
	// rate (so custom currencies stay editable), minus the home currency (always implicitly 1).
	const exchangeRateCurrencies = $derived.by(() => {
		const savedRates = settingsCtx.settings.exchangeRates ?? {};
		const candidates = [...PRESET_CURRENCIES, ...Object.keys(savedRates)];
		return candidates.filter(
			(currency, index) => currency !== settingsCurrency && candidates.indexOf(currency) === index
		);
	});

	$effect(() => {
		if (!initialized) {
			settingsFuelUnit = settingsCtx.settings.fuelUnit;
			settingsCurrency = settingsCtx.settings.currency;
			const savedRates = settingsCtx.settings.exchangeRates ?? {};
			exchangeRateDrafts = Object.fromEntries(
				Object.entries(savedRates).map(([currency, rate]) => [currency, String(rate)])
			);
			initialized = true;
		}
	});

	function handleThemeChange(theme: ThemePreference): void {
		const nextSettings: AppSettings = {
			...settingsCtx.settings,
			theme
		};

		if (!saveSettings(nextSettings)) {
			return;
		}

		settingsCtx.updateSettings(nextSettings);
		notifySettingsChanged();
	}

	function handlePresetCurrencySelect(presetCurrency: string): void {
		settingsCurrency = presetCurrency;
		currencyError = '';
		settingsStatusMessage = '';
		settingsErrorMessage = '';
	}

	function handleCurrencyInput(): void {
		currencyError = '';
		settingsStatusMessage = '';
		settingsErrorMessage = '';
	}

	function handleExchangeRateInput(): void {
		settingsStatusMessage = '';
		settingsErrorMessage = '';
	}

	// Build the persisted rate map from the drafts: parse each draft and keep only finite > 0
	// values. Blank/0/negative/NaN drafts are omitted entirely (treated as "no rate").
	function buildExchangeRates(): Record<string, number> {
		const rates: Record<string, number> = {};
		for (const [currency, draft] of Object.entries(exchangeRateDrafts)) {
			if (currency === settingsCurrency || draft.trim().length === 0) {
				continue;
			}
			const parsed = Number(draft);
			if (Number.isFinite(parsed) && parsed > 0) {
				rates[currency] = parsed;
			}
		}
		return rates;
	}

	function handleSettingsSubmit(event: SubmitEvent): void {
		event.preventDefault();

		if (settingsCurrency.trim().length === 0) {
			currencyError = 'Enter a currency symbol or prefix.';
			settingsStatusMessage = '';
			settingsErrorMessage = '';
			return;
		}

		// Rates are defined relative to the home currency; if it changed, the saved rates are no
		// longer meaningful, so drop them and let the user re-enter against the new home currency.
		const homeCurrencyChanged = settingsCurrency !== settingsCtx.settings.currency;
		const exchangeRates = homeCurrencyChanged ? {} : buildExchangeRates();
		const nextSettings: AppSettings = {
			fuelUnit: settingsFuelUnit,
			currency: settingsCurrency,
			theme: settingsCtx.settings.theme,
			...(Object.keys(exchangeRates).length > 0 ? { exchangeRates } : {})
		};

		currencyError = '';
		settingsStatusMessage = '';
		settingsErrorMessage = '';

		if (!saveSettings(nextSettings)) {
			settingsErrorMessage =
				'Could not save settings on this device. Allow storage access and try again.';
			return;
		}

		settingsCtx.updateSettings(nextSettings);
		notifySettingsChanged();
		settingsStatusMessage = 'Settings saved.';
	}

	// Backup & Restore --------------------------------------------------------------------------
	let backupStatusMessage = $state('');
	let backupErrorMessage = $state('');
	// A parsed, validated backup awaiting the user's explicit confirm before it replaces all data.
	// Kept OUT of $state on purpose: $state deep-proxies the object graph, and a Proxy is not
	// structured-cloneable, so IndexedDB bulkPut throws DataCloneError. The confirm panel's
	// visibility is tracked by the separate reactive `showRestoreConfirm` flag instead.
	let pendingRestore: { data: BackupData; settings: AppSettings } | null = null;
	let showRestoreConfirm = $state(false);
	let fileInput = $state<HTMLInputElement | null>(null);

	function resetBackupMessages(): void {
		backupStatusMessage = '';
		backupErrorMessage = '';
	}

	async function handleDownloadBackup(): Promise<void> {
		resetBackupMessages();
		const result = await exportAllTables();
		if (result.error) {
			backupErrorMessage = 'Could not read your data to back up. Please try again.';
			return;
		}
		const json = serializeBackup(result.data, settingsCtx.settings);
		downloadBackupFile(json, buildBackupFilename(new Date()));
		backupStatusMessage = 'Backup downloaded.';
	}

	async function handleRestoreFileChange(event: Event): Promise<void> {
		resetBackupMessages();
		pendingRestore = null;
		showRestoreConfirm = false;
		const input = event.currentTarget as HTMLInputElement;
		const file = input.files?.[0];
		if (!file) return;

		if (file.size > IMPORT_FILE_SIZE_MAX_BYTES) {
			backupErrorMessage = 'This file is too large to be a passanger backup.';
			input.value = '';
			return;
		}

		const parsed = parseBackup(await file.text());
		// Allow re-selecting the same file later by clearing the input value now.
		input.value = '';
		if (parsed.error) {
			backupErrorMessage = parsed.error.message;
			return;
		}
		pendingRestore = parsed.data;
		showRestoreConfirm = true;
	}

	function cancelRestore(): void {
		pendingRestore = null;
		showRestoreConfirm = false;
		resetBackupMessages();
	}

	async function confirmRestore(): Promise<void> {
		if (!pendingRestore) return;
		const restore = pendingRestore;
		// Clear pending state before the await so a double-click can't trigger a second restore.
		pendingRestore = null;
		showRestoreConfirm = false;
		resetBackupMessages();

		const result = await restoreAllTables(restore.data);
		if (result.error) {
			backupErrorMessage = result.error.message;
			return;
		}

		if (!saveSettings(restore.settings)) {
			// Data restored, but the settings write failed (e.g. storage full). Surface it instead of
			// reloading into restored-data-with-stale-settings with no signal.
			backupErrorMessage = 'Your data was restored, but settings could not be saved.';
			// The DB is already replaced for every tab (shared IndexedDB), so other tabs must still be
			// told to reload — even though this tab stays put to show the settings-save error.
			notifyTabsRestored();
			return;
		}
		// Tell other tabs the DB was replaced, then reload so this tab's live queries and settings
		// context rehydrate. The message is posted before reload; BroadcastChannel dispatches it
		// independently of this tab's navigation, so other tabs still receive it (verified by e2e).
		notifyTabsRestored();
		location.reload();
	}
</script>

<svelte:head>
	<title>Settings | passanger</title>
</svelte:head>

<div class="space-y-6 px-4 pt-4">
	<section
		aria-labelledby="settings-appearance-heading"
		class="space-y-5 rounded-2xl border border-border bg-card p-5 shadow-sm"
	>
		<div class="space-y-1">
			<h2 id="settings-appearance-heading" class="text-lg font-semibold text-foreground">
				Appearance
			</h2>
			<p class="text-sm text-muted-foreground">Choose how passanger looks</p>
		</div>

		<!-- svelte-ignore a11y_interactive_supports_focus -->
		<div
			role="radiogroup"
			aria-label="Theme"
			class="grid grid-cols-3 gap-2"
			onkeydown={(e: KeyboardEvent) => {
				const currentIndex = THEME_OPTIONS.findIndex((o) => o.value === settingsCtx.settings.theme);
				let nextIndex = -1;
				if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
					nextIndex = (currentIndex + 1) % THEME_OPTIONS.length;
				} else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
					nextIndex = (currentIndex - 1 + THEME_OPTIONS.length) % THEME_OPTIONS.length;
				}
				if (nextIndex >= 0) {
					e.preventDefault();
					handleThemeChange(THEME_OPTIONS[nextIndex].value);
					const target = (e.currentTarget as HTMLElement).querySelectorAll<HTMLElement>(
						'[role="radio"]'
					)[nextIndex];
					target?.focus();
				}
			}}
		>
			{#each THEME_OPTIONS as option (option.value)}
				<button
					type="button"
					role="radio"
					aria-checked={settingsCtx.settings.theme === option.value}
					tabindex={settingsCtx.settings.theme === option.value ? 0 : -1}
					onclick={() => handleThemeChange(option.value)}
					class="flex flex-col items-center gap-1 rounded-xl border px-3 py-3 text-sm transition-colors {settingsCtx
						.settings.theme === option.value
						? 'border-accent bg-accent/5 font-semibold text-accent'
						: 'border-border text-foreground hover:bg-muted/60'}"
				>
					<span class="font-medium">{option.label}</span>
					<span
						class="text-xs {settingsCtx.settings.theme === option.value
							? 'text-accent'
							: 'text-muted-foreground'}">{option.description}</span
					>
				</button>
			{/each}
		</div>
	</section>

	<section
		aria-labelledby="settings-vehicles-heading"
		class="space-y-5 rounded-2xl border border-border bg-card p-5 shadow-sm"
	>
		<div class="space-y-1">
			<h2 id="settings-vehicles-heading" class="text-lg font-semibold text-foreground">Vehicles</h2>
			<p class="text-sm text-muted-foreground">Manage your vehicles</p>
		</div>
		<VehicleListManager {activeVehicleId} onActiveVehicleChange={handleActiveVehicleChange} />
	</section>

	<section
		aria-labelledby="settings-reminders-heading"
		class="space-y-5 rounded-2xl border border-border bg-card p-5 shadow-sm"
	>
		<div class="space-y-1">
			<h2 id="settings-reminders-heading" class="text-lg font-semibold text-foreground">
				Reminders
			</h2>
			<p class="text-sm text-muted-foreground">Set maintenance reminders</p>
		</div>
		{#if activeVehicle}
			<ServiceReminderManager vehicleId={activeVehicle.id} {currentOdometer} />
		{:else}
			<p class="text-sm text-muted-foreground">
				Add a vehicle and select it as active to set maintenance reminders.
			</p>
		{/if}
	</section>

	<section
		aria-labelledby="settings-backup-heading"
		class="space-y-5 rounded-2xl border border-border bg-card p-5 shadow-sm"
	>
		<div class="space-y-1">
			<h2 id="settings-backup-heading" class="text-lg font-semibold text-foreground">
				Backup & Restore
			</h2>
			<p class="text-sm text-muted-foreground">
				Save a full copy of your data as a file, or restore one. Everything stays on your device.
			</p>
		</div>

		<div class="space-y-3">
			<Button onclick={handleDownloadBackup}>Download backup</Button>

			<div class="space-y-1">
				<label for="settings-restore-file" class="text-sm font-medium text-foreground">
					Restore from a backup
				</label>
				<!-- File input stays a raw input: Field omits type=file/files. Restyle only; keep the id. -->
				<input
					id="settings-restore-file"
					bind:this={fileInput}
					type="file"
					accept=".json,application/json"
					onchange={handleRestoreFileChange}
					class="block w-full text-base text-foreground file:mr-3 file:min-h-11 file:rounded-md file:border file:border-border file:bg-muted/60 file:px-4 file:py-2 file:text-sm file:font-semibold file:text-foreground"
				/>
			</div>
		</div>

		{#if showRestoreConfirm}
			<div
				role="alertdialog"
				aria-labelledby="settings-restore-confirm-heading"
				aria-describedby="settings-restore-confirm-body"
				class="space-y-3 rounded-xl border border-destructive/40 bg-destructive/5 p-4"
			>
				<h3 id="settings-restore-confirm-heading" class="text-sm font-semibold text-foreground">
					Replace all data?
				</h3>
				<p id="settings-restore-confirm-body" class="text-sm text-muted-foreground">
					This REPLACES all current data and settings with the backup. This cannot be undone.
				</p>
				<div class="flex flex-wrap gap-2">
					<Button variant="destructive" onclick={confirmRestore}>Replace all</Button>
					<Button variant="outline" onclick={cancelRestore}>Cancel</Button>
				</div>
			</div>
		{/if}

		{#if backupErrorMessage}
			<p role="alert" class="text-sm text-destructive">{backupErrorMessage}</p>
		{:else if backupStatusMessage}
			<p role="status" class="text-sm text-muted-foreground">{backupStatusMessage}</p>
		{/if}
	</section>

	<section
		aria-labelledby="settings-units-currency-heading"
		class="space-y-5 rounded-2xl border border-border bg-card p-5 shadow-sm"
	>
		<div class="space-y-1">
			<h2 id="settings-units-currency-heading" class="text-lg font-semibold text-foreground">
				Units & Currency
			</h2>
			<p class="text-sm text-muted-foreground">
				Choose how fuel efficiency and costs are displayed everywhere in the app.
			</p>
		</div>

		<form class="space-y-5" onsubmit={handleSettingsSubmit}>
			<fieldset aria-describedby={fuelUnitHelpId} class="space-y-3">
				<legend class="text-sm font-medium text-foreground">Fuel efficiency unit</legend>
				<p id={fuelUnitHelpId} class="text-sm text-muted-foreground">
					Save a unit preference to refresh result cards, history summaries, and entry details.
				</p>

				<div class="grid gap-2 sm:grid-cols-2">
					{#each SUPPORTED_UNITS as unit (unit)}
						<label
							class="flex min-h-11 cursor-pointer items-center gap-3 rounded-xl border border-border px-4 py-3 text-sm font-medium text-foreground"
						>
							<input bind:group={settingsFuelUnit} type="radio" name="fuel-unit" value={unit} />
							<span>{unit}</span>
						</label>
					{/each}
				</div>
			</fieldset>

			<div class="space-y-3">
				<p id={currencyHelpId} class="text-sm text-muted-foreground">
					Choose a preset or enter a custom value such as `EUR `.
				</p>

				<div class="flex flex-wrap gap-2">
					{#each PRESET_CURRENCIES as presetCurrency (presetCurrency)}
						<Button
							variant="outline"
							aria-pressed={settingsCurrency === presetCurrency}
							onclick={() => handlePresetCurrencySelect(presetCurrency)}
						>
							{presetCurrency}
						</Button>
					{/each}
				</div>

				<Field
					label="Currency prefix"
					type="text"
					inputmode="text"
					bind:value={settingsCurrency}
					error={currencyError}
					aria-describedby={currencyHelpId}
					oninput={handleCurrencyInput}
				/>
			</div>

			<fieldset class="space-y-3">
				<legend class="text-sm font-medium text-foreground">Exchange rates</legend>
				<p id="settings-exchange-rates-help" class="text-sm text-muted-foreground">
					Optional. Enter how much each currency is worth in {settingsCurrency.trim() ||
						settingsCurrency} to see an approximate combined total. Leave blank to skip.
				</p>

				<div class="space-y-2">
					{#each exchangeRateCurrencies as rateCurrency (rateCurrency)}
						<div class="flex items-end gap-3">
							<Field
								label={`1 ${rateCurrency} =`}
								type="number"
								inputmode="decimal"
								min="0"
								step="any"
								bind:value={exchangeRateDrafts[rateCurrency]}
								aria-describedby="settings-exchange-rates-help"
								oninput={handleExchangeRateInput}
								class="w-32"
							/>
							<span class="pb-3 text-sm text-muted-foreground"
								>{settingsCurrency.trim() || settingsCurrency}</span
							>
						</div>
					{/each}
				</div>
			</fieldset>

			<div class="border-t border-border pt-4">
				<Button type="submit" size="lg">Save settings</Button>
			</div>

			{#if settingsErrorMessage}
				<p role="alert" class="text-sm text-destructive">{settingsErrorMessage}</p>
			{:else if settingsStatusMessage}
				<p role="status" class="text-sm text-muted-foreground">{settingsStatusMessage}</p>
			{/if}
		</form>
	</section>

	<section
		aria-labelledby="settings-data-heading"
		class="space-y-5 rounded-2xl border border-border bg-card p-5 shadow-sm"
	>
		<div class="space-y-1">
			<h2 id="settings-data-heading" class="text-lg font-semibold text-foreground">Data</h2>
			<p class="text-sm text-muted-foreground">Manage your app data</p>
		</div>
		<p class="text-sm text-muted-foreground">Coming soon</p>
	</section>
</div>
