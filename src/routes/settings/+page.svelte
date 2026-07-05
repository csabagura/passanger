<script lang="ts">
	import { getContext, onMount } from 'svelte';
	import {
		PRESET_CURRENCIES,
		SUPPORTED_UNITS,
		IMPORT_FILE_SIZE_MAX_BYTES,
		SUPPORTED_LOCALES,
		SETTINGS_RESTORE_COERCED_NOTICE_KEY
	} from '$lib/config';
	import { saveSettings, type AppSettings, type ThemePreference } from '$lib/utils/settings';
	import { notifySettingsChanged, notifyTabsRestored } from '$lib/utils/tabSync';
	import { exportAllTables, restoreAllTables, type BackupData } from '$lib/db/backup';
	import { importVehicleShare } from '$lib/db/vehicleShare';
	import {
		serializeBackup,
		parseBackup,
		downloadBackupFile,
		buildBackupFilename
	} from '$lib/utils/backup';
	import { parseVehicleShare, type VehicleShareData } from '$lib/utils/vehicleShare';
	import VehicleListManager from '$lib/components/VehicleListManager.svelte';
	import { Button } from '$lib/components/ui/button';
	import { Field } from '$lib/components/ui/field';
	import { m } from '$lib/paraglide/messages';
	import { getLocale, setLocale, isLocale } from '$lib/paraglide/runtime';
	import type { VehiclesContext } from '$lib/utils/vehicleContext';

	function handleLanguageChange(event: Event): void {
		const next = (event.currentTarget as HTMLSelectElement).value;
		// Reload-on-switch (Paraglide setLocale default): persists the choice to localStorage and
		// reloads so every m.*() re-evaluates under the new locale. A rare Settings action; the PWA
		// rehydrates from IndexedDB on reload. isLocale guards so only supported locales are accepted.
		if (isLocale(next)) {
			setLocale(next);
		}
	}

	// THEME_OPTIONS values are the persisted enum (system|light|dark) and MUST NOT change; only the
	// user-facing label/description are translated.
	const THEME_OPTIONS: { value: ThemePreference; label: string; description: string }[] = [
		{
			value: 'system',
			label: m.settings_theme_system(),
			description: m.settings_theme_system_desc()
		},
		{ value: 'light', label: m.settings_theme_light(), description: m.settings_theme_light_desc() },
		{ value: 'dark', label: m.settings_theme_dark(), description: m.settings_theme_dark_desc() }
	];

	let settingsFuelUnit = $state<AppSettings['fuelUnit']>('L/100km');
	let settingsCurrency = $state('');
	let currencyError = $state('');
	let settingsStatusMessage = $state('');
	let settingsErrorMessage = $state('');
	// S28: replaces the former one-shot `initialized` latch — that copied `settingsCtx.settings`
	// into local state exactly once, so a cross-tab settings change never reached this form after
	// first mount (a local Save would then silently revert the remote change). `dirty` tracks
	// whether the user has an in-progress unsaved edit; the effect below re-syncs from the context
	// whenever it changes AND the user has no pending edit, and is reset on a successful save.
	let dirty = $state(false);
	// Exchange-rate drafts kept as strings (inputs may be blank/partial). Sanitised to finite
	// > 0 numbers on save; blank/0/negative entries are dropped from settings.exchangeRates.
	let exchangeRateDrafts = $state<Record<string, string>>({});

	const settingsCtx = getContext<{
		settings: AppSettings;
		updateSettings: (settings: AppSettings) => void;
	}>('settings');
	// H12: read the layout's single shared vehicles channel directly — Settings no longer keeps its
	// own disconnected activeVehicleId mirror (VehicleListManager reconciles this context itself).
	const vehiclesCtx = getContext<VehiclesContext>('vehicles');
	// S30: so a failed restore-settings write can arm the SAME reload latch other tabs get.
	const tabSyncCtx = getContext<{ markRestorePending: () => void } | undefined>('tabSync');

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
		if (dirty) return;
		settingsFuelUnit = settingsCtx.settings.fuelUnit;
		settingsCurrency = settingsCtx.settings.currency;
		const savedRates = settingsCtx.settings.exchangeRates ?? {};
		exchangeRateDrafts = Object.fromEntries(
			Object.entries(savedRates).map(([currency, rate]) => [currency, String(rate)])
		);
	});

	function handleThemeChange(theme: ThemePreference): void {
		const nextSettings: AppSettings = {
			...settingsCtx.settings,
			theme
		};

		if (saveSettings(nextSettings).error) {
			return;
		}

		settingsCtx.updateSettings(nextSettings);
		notifySettingsChanged();
	}

	function handlePresetCurrencySelect(presetCurrency: string): void {
		dirty = true;
		settingsCurrency = presetCurrency;
		currencyError = '';
		settingsStatusMessage = '';
		settingsErrorMessage = '';
	}

	function handleCurrencyInput(): void {
		dirty = true;
		currencyError = '';
		settingsStatusMessage = '';
		settingsErrorMessage = '';
	}

	function handleExchangeRateInput(): void {
		dirty = true;
		settingsStatusMessage = '';
		settingsErrorMessage = '';
	}

	function handleFuelUnitChange(): void {
		dirty = true;
	}

	// Build the persisted rate map from the drafts: parse each draft and keep only finite > 0
	// values. Blank/0/negative/NaN drafts are omitted entirely (treated as "no rate").
	// NOTE (Story 5.2): a freshly-typed rate arrives here as a `number` — the per-row Field is a
	// `<input type="number">`, so Svelte coerces `bind:value` back to a number despite the
	// `Record<string, string>` draft type (saved rates seed as strings via `String(rate)`, typed ones
	// do not). Normalise with `String(draft)` before trimming/parsing; calling `.trim()` on the number
	// threw `TypeError: n.trim is not a function`, which aborted the save so no Display Rate ever
	// persisted (latent since the rate UI shipped — uncovered by tests until this story's e2e).
	function buildExchangeRates(): Record<string, number> {
		const rates: Record<string, number> = {};
		for (const [currency, draft] of Object.entries(exchangeRateDrafts)) {
			const draftText = String(draft).trim();
			if (currency === settingsCurrency || draftText.length === 0) {
				continue;
			}
			const parsed = Number(draftText);
			if (Number.isFinite(parsed) && parsed > 0) {
				rates[currency] = parsed;
			}
		}
		return rates;
	}

	function handleSettingsSubmit(event: SubmitEvent): void {
		event.preventDefault();

		if (settingsCurrency.trim().length === 0) {
			currencyError = m.settings_currency_error_blank();
			settingsStatusMessage = '';
			settingsErrorMessage = '';
			return;
		}

		// Rates are defined relative to the home currency; if it changed, the saved rates are no
		// longer meaningful, so drop them and let the user re-enter against the new home currency.
		const homeCurrencyChanged = settingsCurrency !== settingsCtx.settings.currency;
		const exchangeRates = homeCurrencyChanged ? {} : buildExchangeRates();
		// Spread the current settings so fields this form doesn't own (heroMetric, any future
		// optional field) survive the save instead of being wiped.
		const nextSettings: AppSettings = {
			...settingsCtx.settings,
			fuelUnit: settingsFuelUnit,
			currency: settingsCurrency
		};
		if (Object.keys(exchangeRates).length > 0) {
			nextSettings.exchangeRates = exchangeRates;
		} else {
			// The key must be ABSENT, not {} — a home-currency change drops the rates, and the spread
			// above would otherwise resurrect the stale map.
			delete nextSettings.exchangeRates;
		}

		currencyError = '';
		settingsStatusMessage = '';
		settingsErrorMessage = '';

		if (saveSettings(nextSettings).error) {
			settingsErrorMessage = m.settings_save_error();
			return;
		}

		settingsCtx.updateSettings(nextSettings);
		notifySettingsChanged();
		settingsStatusMessage = m.settings_save_success();
		// S28: the next remote change (another tab's settings write) should re-sync cleanly again.
		dirty = false;
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

	// S34: show the coerced-restore notice once, across the reload confirmRestore triggers.
	onMount(() => {
		try {
			if (sessionStorage.getItem(SETTINGS_RESTORE_COERCED_NOTICE_KEY) === 'true') {
				sessionStorage.removeItem(SETTINGS_RESTORE_COERCED_NOTICE_KEY);
				backupStatusMessage = m.settings_restore_settings_coerced();
			}
		} catch {
			// Best-effort — absence of the notice is not worth crashing mount over.
		}
	});

	async function handleDownloadBackup(): Promise<void> {
		resetBackupMessages();
		const result = await exportAllTables();
		if (result.error) {
			backupErrorMessage = m.settings_backup_error_read();
			return;
		}
		const json = serializeBackup(result.data, settingsCtx.settings);
		downloadBackupFile(json, buildBackupFilename(new Date()));
		backupStatusMessage = m.settings_backup_downloaded();
	}

	async function handleRestoreFileChange(event: Event): Promise<void> {
		resetBackupMessages();
		pendingRestore = null;
		showRestoreConfirm = false;
		const input = event.currentTarget as HTMLInputElement;
		const file = input.files?.[0];
		if (!file) return;

		if (file.size > IMPORT_FILE_SIZE_MAX_BYTES) {
			backupErrorMessage = m.settings_backup_error_too_large();
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

		const saveResult = saveSettings(restore.settings);
		if (saveResult.error) {
			// Data restored, but the settings write failed (e.g. storage full). Surface it instead of
			// reloading into restored-data-with-stale-settings with no signal.
			backupErrorMessage = m.settings_restore_settings_failed();
			// The DB is already replaced for every tab (shared IndexedDB), so other tabs must still be
			// told to reload — even though this tab stays put to show the settings-save error.
			notifyTabsRestored();
			// S30: this tab's own view is now stale over the already-replaced DB — arm the same reload
			// banner other tabs get, rather than silently staying live.
			tabSyncCtx?.markRestorePending();
			return;
		}
		// S34: `restore.settings` comes from user-supplied/possibly-corrupted backup JSON — surface when
		// any field was silently substituted with a default rather than claiming an unconditional
		// success. The immediate `location.reload()` below means a message set now would never be
		// seen — stash a show-once flag in sessionStorage and display it after reload instead.
		if (saveResult.data.coercedFields.length > 0) {
			try {
				sessionStorage.setItem(SETTINGS_RESTORE_COERCED_NOTICE_KEY, 'true');
			} catch {
				// Best-effort — a missed notice here is not worth crashing the restore over.
			}
		}
		// Tell other tabs the DB was replaced, then reload so this tab's live queries and settings
		// context rehydrate. The message is posted before reload; BroadcastChannel dispatches it
		// independently of this tab's navigation, so other tabs still receive it (verified by e2e).
		notifyTabsRestored();
		location.reload();
	}

	// Import a shared car (Story 9.3) ------------------------------------------------------------
	// Distinct from restore: this ADDS a new vehicle (remapping all foreign keys) — it never
	// replaces existing data and never touches settings, so no reload/replace-all banner is needed.
	let carImportStatusMessage = $state('');
	let carImportErrorMessage = $state('');
	// Kept OUT of $state (same reason as pendingRestore): $state deep-proxies the graph and a Proxy is
	// not structured-cloneable, so an IndexedDB add would throw DataCloneError.
	let pendingCarImport: VehicleShareData | null = null;
	let showCarImportConfirm = $state(false);
	let carFileInput = $state<HTMLInputElement | null>(null);

	function resetCarImportMessages(): void {
		carImportStatusMessage = '';
		carImportErrorMessage = '';
	}

	async function handleCarImportFileChange(event: Event): Promise<void> {
		resetCarImportMessages();
		pendingCarImport = null;
		showCarImportConfirm = false;
		const input = event.currentTarget as HTMLInputElement;
		const file = input.files?.[0];
		if (!file) return;

		if (file.size > IMPORT_FILE_SIZE_MAX_BYTES) {
			carImportErrorMessage = m.settings_backup_error_too_large();
			input.value = '';
			return;
		}

		const parsed = parseVehicleShare(await file.text());
		// Allow re-selecting the same file later by clearing the input value now.
		input.value = '';
		if (parsed.error) {
			carImportErrorMessage = parsed.error.message;
			return;
		}
		pendingCarImport = parsed.data;
		showCarImportConfirm = true;
	}

	function cancelCarImport(): void {
		pendingCarImport = null;
		showCarImportConfirm = false;
		resetCarImportMessages();
	}

	async function confirmCarImport(): Promise<void> {
		if (!pendingCarImport) return;
		const share = pendingCarImport;
		// Clear pending state before the await so a double-click can't trigger a second import.
		pendingCarImport = null;
		showCarImportConfirm = false;
		resetCarImportMessages();

		const result = await importVehicleShare(share);
		if (result.error) {
			carImportErrorMessage = result.error.message;
			return;
		}

		// Additive merge — reconcile the shared vehicles context so the new car appears in the switcher
		// and this page's own VehicleListManager same-tab, without a whole-DB reload.
		await vehiclesCtx.refreshVehicles();
		carImportStatusMessage = m.settings_car_import_success({ name: result.data.vehicleName });
	}
</script>

<svelte:head>
	<title>{m.settings_title()} | passanger</title>
</svelte:head>

<div class="space-y-6 px-4 pt-4">
	<section
		aria-labelledby="settings-appearance-heading"
		class="space-y-5 rounded-2xl border border-border bg-card p-5 shadow-sm"
	>
		<div class="space-y-1">
			<h2 id="settings-appearance-heading" class="text-lg font-semibold text-foreground">
				{m.settings_appearance_heading()}
			</h2>
			<p class="text-sm text-muted-foreground">{m.settings_appearance_desc()}</p>
		</div>

		<!-- svelte-ignore a11y_interactive_supports_focus -->
		<div
			role="radiogroup"
			aria-label={m.settings_theme_label()}
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
					class="flex min-h-11 flex-col items-center justify-center gap-1 rounded-xl border px-3 py-3 text-sm transition-colors {settingsCtx
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
		aria-labelledby="settings-language-heading"
		class="space-y-5 rounded-2xl border border-border bg-card p-5 shadow-sm"
	>
		<div class="space-y-1">
			<h2 id="settings-language-heading" class="text-lg font-semibold text-foreground">
				{m.settings_language_label()}
			</h2>
		</div>
		<select
			aria-labelledby="settings-language-heading"
			value={getLocale()}
			onchange={handleLanguageChange}
			class="min-h-11 w-full rounded-md border border-border bg-card px-3 py-2 text-base text-foreground"
		>
			{#each SUPPORTED_LOCALES as loc (loc)}
				<option value={loc}>
					{loc === 'hu' ? m.settings_language_hungarian() : m.settings_language_english()}
				</option>
			{/each}
		</select>
	</section>

	<section
		aria-labelledby="settings-vehicles-heading"
		class="space-y-5 rounded-2xl border border-border bg-card p-5 shadow-sm"
	>
		<div class="space-y-1">
			<h2 id="settings-vehicles-heading" class="text-lg font-semibold text-foreground">
				{m.settings_vehicles_heading()}
			</h2>
			<p class="text-sm text-muted-foreground">{m.settings_vehicles_desc()}</p>
		</div>
		<VehicleListManager activeVehicleId={vehiclesCtx.activeVehicleId} />

		<div class="space-y-3 border-t border-border pt-5">
			<div class="space-y-1">
				<h3 class="text-sm font-semibold text-foreground">{m.settings_car_import_heading()}</h3>
				<p class="text-sm text-muted-foreground">{m.settings_car_import_desc()}</p>
			</div>

			<div class="space-y-1">
				<label for="settings-car-import-file" class="text-sm font-medium text-foreground">
					{m.settings_car_import_label()}
				</label>
				<input
					id="settings-car-import-file"
					bind:this={carFileInput}
					type="file"
					accept=".json,application/json"
					onchange={handleCarImportFileChange}
					class="block w-full text-base text-foreground file:mr-3 file:min-h-11 file:rounded-md file:border file:border-border file:bg-muted/60 file:px-4 file:py-2 file:text-sm file:font-semibold file:text-foreground"
				/>
			</div>

			{#if showCarImportConfirm}
				<div
					role="alertdialog"
					aria-labelledby="settings-car-import-confirm-heading"
					aria-describedby="settings-car-import-confirm-body"
					class="space-y-3 rounded-xl border border-border bg-muted/40 p-4"
				>
					<h4
						id="settings-car-import-confirm-heading"
						class="text-sm font-semibold text-foreground"
					>
						{m.settings_car_import_confirm_heading()}
					</h4>
					<p id="settings-car-import-confirm-body" class="text-sm text-muted-foreground">
						{m.settings_car_import_confirm_body()}
					</p>
					<div class="flex flex-wrap gap-2">
						<Button onclick={confirmCarImport}>{m.settings_car_import_confirm_add()}</Button>
						<Button variant="outline" onclick={cancelCarImport}>{m.common_cancel()}</Button>
					</div>
				</div>
			{/if}

			{#if carImportErrorMessage}
				<p role="alert" class="text-sm text-destructive">{carImportErrorMessage}</p>
			{:else if carImportStatusMessage}
				<p role="status" class="text-sm text-muted-foreground">{carImportStatusMessage}</p>
			{/if}
		</div>
	</section>

	<section
		aria-labelledby="settings-backup-heading"
		class="space-y-5 rounded-2xl border border-border bg-card p-5 shadow-sm"
	>
		<div class="space-y-1">
			<h2 id="settings-backup-heading" class="text-lg font-semibold text-foreground">
				{m.settings_backup_heading()}
			</h2>
			<p class="text-sm text-muted-foreground">
				{m.settings_backup_desc()}
			</p>
		</div>

		<div class="space-y-3">
			<Button onclick={handleDownloadBackup}>{m.settings_backup_download()}</Button>

			<div class="space-y-1">
				<label for="settings-restore-file" class="text-sm font-medium text-foreground">
					{m.settings_backup_restore_label()}
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
					{m.settings_restore_confirm_heading()}
				</h3>
				<p id="settings-restore-confirm-body" class="text-sm text-muted-foreground">
					{m.settings_restore_confirm_body()}
				</p>
				<div class="flex flex-wrap gap-2">
					<!-- AA contrast (Story 6.3 / AC5): outline + destructive TEXT (~4.5:1 on card),
					     not the bg-destructive/10 fill (~3.86:1). -->
					<Button
						variant="outline"
						class="text-destructive hover:text-destructive"
						onclick={confirmRestore}>{m.settings_restore_confirm_replace()}</Button
					>
					<Button variant="outline" onclick={cancelRestore}>{m.common_cancel()}</Button>
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
				{m.settings_units_currency_heading()}
			</h2>
			<p class="text-sm text-muted-foreground">
				{m.settings_units_currency_desc()}
			</p>
		</div>

		<form class="space-y-5" onsubmit={handleSettingsSubmit}>
			<fieldset aria-describedby={fuelUnitHelpId} class="space-y-3">
				<legend class="text-sm font-medium text-foreground">{m.settings_fuel_unit_legend()}</legend>
				<p id={fuelUnitHelpId} class="text-sm text-muted-foreground">
					{m.settings_fuel_unit_help()}
				</p>

				<div class="grid gap-2 sm:grid-cols-2">
					{#each SUPPORTED_UNITS as unit (unit)}
						<label
							class="flex min-h-11 cursor-pointer items-center gap-3 rounded-xl border border-border px-4 py-3 text-sm font-medium text-foreground"
						>
							<input
								bind:group={settingsFuelUnit}
								type="radio"
								name="fuel-unit"
								value={unit}
								onchange={handleFuelUnitChange}
							/>
							<span>{unit}</span>
						</label>
					{/each}
				</div>
			</fieldset>

			<div class="space-y-3">
				<p id={currencyHelpId} class="text-sm text-muted-foreground">
					{m.settings_currency_help()}
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
					label={m.settings_currency_prefix_label()}
					type="text"
					inputmode="text"
					bind:value={settingsCurrency}
					error={currencyError}
					aria-describedby={currencyHelpId}
					oninput={handleCurrencyInput}
				/>
			</div>

			<fieldset class="space-y-3">
				<legend class="text-sm font-medium text-foreground"
					>{m.settings_display_rate_legend()}</legend
				>
				<p id="settings-exchange-rates-help" class="text-sm text-muted-foreground">
					{m.settings_display_rate_help({
						currency: settingsCurrency.trim() || settingsCurrency
					})}
				</p>

				<div class="space-y-2">
					{#each exchangeRateCurrencies as rateCurrency (rateCurrency)}
						<div class="flex items-end gap-3">
							<Field
								label={m.settings_rate_row_label({ currency: rateCurrency })}
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
				<Button type="submit" size="lg">{m.settings_save_button()}</Button>
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
			<h2 id="settings-data-heading" class="text-lg font-semibold text-foreground">
				{m.settings_data_heading()}
			</h2>
			<p class="text-sm text-muted-foreground">{m.settings_data_desc()}</p>
		</div>
		<p class="text-sm text-muted-foreground">{m.settings_data_coming_soon()}</p>
	</section>
</div>
