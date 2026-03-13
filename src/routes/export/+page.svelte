<script lang="ts">
	import { resolve } from '$app/paths';
	import Settings from '@lucide/svelte/icons/settings';
	import { getContext } from 'svelte';
	import { PRESET_CURRENCIES, SUPPORTED_UNITS, VEHICLE_ID_STORAGE_KEY } from '$lib/config';
	import { getAllExpenses } from '$lib/db/repositories/expenses';
	import { getAllFuelLogs } from '$lib/db/repositories/fuelLogs';
	import { getAllVehicles, getVehicleById } from '$lib/db/repositories/vehicles';
	import type { Vehicle } from '$lib/db/schema';
	import { buildCSVFilename, buildHistoryExportCSV, downloadCSV } from '$lib/utils/csv';
	import { formatLocalCalendarDate } from '$lib/utils/date';
	import { mergeHistoryEntries, type HistoryEntry } from '$lib/utils/historyEntries';
	import { saveSettings, type AppSettings } from '$lib/utils/settings';
	import { readStoredVehicleId, safeRemoveItem, safeSetItem } from '$lib/utils/vehicleStorage';

	let currentVehicle = $state<Vehicle | null>(null);
	let historyEntries = $state<HistoryEntry[]>([]);
	let loading = $state(true);
	let loadStarted = $state(false);
	let exporting = $state(false);
	let errorMessage = $state('');
	let settingsOpen = $state(false);
	let settingsFuelUnit = $state<AppSettings['fuelUnit']>('L/100km');
	let settingsCurrency = $state('');
	let currencyError = $state('');
	let settingsStatusMessage = $state('');
	let settingsErrorMessage = $state('');

	const settingsCtx = getContext<{
		settings: AppSettings;
		updateSettings: (settings: AppSettings) => void;
	}>('settings');
	const exportSectionId = 'export-route-primary-action';
	const settingsPanelId = 'export-settings-panel';
	const fuelUnitHelpId = 'export-settings-fuel-unit-help';
	const currencyHelpId = 'export-settings-currency-help';
	const currencyErrorId = 'export-settings-currency-error';

	const hasEntries = $derived(historyEntries.length > 0);
	const showExportActionCard = $derived(hasEntries || (loading && !errorMessage));
	const exportButtonDisabled = $derived(exporting || loading || !currentVehicle || !hasEntries);
	const entrySummary = $derived(
		`${historyEntries.length} ${historyEntries.length === 1 ? 'entry' : 'entries'} ready`
	);
	const dateRangeSummary = $derived.by(() => {
		if (historyEntries.length === 0) {
			return '';
		}

		const newestEntryDate = historyEntries[0].entry.date;
		const oldestEntryDate = historyEntries[historyEntries.length - 1].entry.date;

		if (historyEntries.length === 1) {
			return formatLocalCalendarDate(newestEntryDate);
		}

		return `${formatLocalCalendarDate(oldestEntryDate)} - ${formatLocalCalendarDate(newestEntryDate)}`;
	});

	function resetSettingsDraft(): void {
		settingsFuelUnit = settingsCtx.settings.fuelUnit;
		settingsCurrency = settingsCtx.settings.currency;
		currencyError = '';
		settingsStatusMessage = '';
		settingsErrorMessage = '';
	}

	function toggleSettings(): void {
		if (!settingsOpen) {
			resetSettingsDraft();
		} else {
			currencyError = '';
			settingsStatusMessage = '';
			settingsErrorMessage = '';
		}

		settingsOpen = !settingsOpen;
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

	function handleSettingsSubmit(event: SubmitEvent): void {
		event.preventDefault();

		if (settingsCurrency.trim().length === 0) {
			currencyError = 'Enter a currency symbol or prefix.';
			settingsStatusMessage = '';
			settingsErrorMessage = '';
			return;
		}

		const nextSettings: AppSettings = {
			fuelUnit: settingsFuelUnit,
			currency: settingsCurrency
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
		settingsStatusMessage = 'Settings saved.';
	}

	async function resolveCurrentVehicle(): Promise<Vehicle | null> {
		const storedVehicleId = readStoredVehicleId();
		if (storedVehicleId !== null) {
			const result = await getVehicleById(storedVehicleId);
			if (!result.error) {
				return result.data;
			}

			if (result.error.code !== 'NOT_FOUND') {
				throw new Error('GET_FAILED');
			}

			safeRemoveItem(VEHICLE_ID_STORAGE_KEY);
		}

		const recoveryResult = await getAllVehicles();
		if (!recoveryResult.error && recoveryResult.data && recoveryResult.data.length > 0) {
			const recoveredVehicle = recoveryResult.data[0];
			safeSetItem(VEHICLE_ID_STORAGE_KEY, String(recoveredVehicle.id));
			return recoveredVehicle;
		}

		if (recoveryResult.error) {
			throw new Error(recoveryResult.error.code);
		}

		return null;
	}

	async function loadExportPage(): Promise<void> {
		loading = true;
		errorMessage = '';
		currentVehicle = null;
		historyEntries = [];

		try {
			const vehicle = await resolveCurrentVehicle();
			currentVehicle = vehicle;

			if (!vehicle) {
				return;
			}

			const [fuelResult, expenseResult] = await Promise.all([
				getAllFuelLogs(vehicle.id),
				getAllExpenses(vehicle.id)
			]);

			if (fuelResult.error || expenseResult.error) {
				throw new Error('GET_FAILED');
			}

			historyEntries = mergeHistoryEntries(fuelResult.data ?? [], expenseResult.data ?? []);
		} catch {
			errorMessage = 'Could not prepare your export. Please try again.';
			historyEntries = [];
		} finally {
			loading = false;
		}
	}

	async function handleExport(): Promise<void> {
		if (exporting || !currentVehicle) {
			return;
		}

		exporting = true;
		errorMessage = '';

		try {
			const [fuelResult, expenseResult] = await Promise.all([
				getAllFuelLogs(currentVehicle.id),
				getAllExpenses(currentVehicle.id)
			]);

			if (fuelResult.error || expenseResult.error) {
				throw new Error('GET_FAILED');
			}

			const nextEntries = mergeHistoryEntries(fuelResult.data ?? [], expenseResult.data ?? []);
			historyEntries = nextEntries;

			if (nextEntries.length === 0) {
				return;
			}

			const content = buildHistoryExportCSV(nextEntries);
			const filename = buildCSVFilename(new Date());

			downloadCSV(content, filename);
		} catch {
			errorMessage = 'Could not export your data. Please try again.';
		} finally {
			exporting = false;
		}
	}

	$effect(() => {
		if (loadStarted) {
			return;
		}

		loadStarted = true;
		void loadExportPage();
	});
</script>

<div class="space-y-6 px-4 pt-4">
	<header class="flex items-start justify-between gap-4">
		<div class="space-y-1">
			<h1 class="text-xl font-semibold text-foreground">Export</h1>
			{#if currentVehicle}
				<p class="text-sm text-muted-foreground">
					{currentVehicle.name} · {currentVehicle.make}
					{currentVehicle.model}
					{#if currentVehicle.year}
						· {currentVehicle.year}
					{/if}
				</p>
			{:else}
				<p class="text-sm text-muted-foreground">
					Download a CSV backup of your saved fuel and maintenance history.
				</p>
			{/if}
		</div>

		<button
			type="button"
			onclick={toggleSettings}
			aria-controls={settingsPanelId}
			aria-expanded={settingsOpen}
			aria-label={settingsOpen ? 'Close settings' : 'Open settings'}
			class="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-border bg-card text-muted-foreground shadow-sm transition-colors hover:text-foreground"
		>
			<Settings size={18} aria-hidden="true" />
		</button>
	</header>

	{#if errorMessage}
		<div role="alert" class="rounded-2xl border border-destructive/20 bg-destructive/10 p-4">
			<p class="text-sm text-destructive">{errorMessage}</p>
		</div>
	{/if}

	{#if showExportActionCard}
		<section
			id={exportSectionId}
			class="space-y-4 rounded-2xl border border-border bg-card p-5 shadow-sm"
		>
			<div class="space-y-1">
				{#if hasEntries}
					<p class="text-lg font-semibold text-foreground">{entrySummary}</p>
					<p class="text-sm text-muted-foreground">Date range: {dateRangeSummary}</p>
				{:else}
					<p class="text-lg font-semibold text-foreground">Export CSV</p>
					<p class="text-sm text-muted-foreground">Checking your saved history on this device.</p>
				{/if}
			</div>

			<button
				type="button"
				onclick={handleExport}
				disabled={exportButtonDisabled}
				aria-busy={exporting ? 'true' : undefined}
				class="inline-flex min-h-11 items-center justify-center rounded-xl bg-accent px-5 py-3 text-sm font-semibold text-accent-foreground disabled:cursor-not-allowed disabled:opacity-70"
			>
				{exporting ? 'Exporting...' : 'Export CSV'}
			</button>
		</section>
	{:else if !loading && !errorMessage}
		<section
			id={exportSectionId}
			aria-label="Export empty state"
			class="rounded-2xl border border-dashed border-border bg-card px-4 py-8 text-center"
		>
			<p class="text-base font-semibold text-foreground">
				Nothing to export yet - log your first fill-up!
			</p>
			<p class="mt-2 text-sm text-muted-foreground">
				Your saved entries will be ready here as soon as you log them.
			</p>
			<a
				href={resolve('/fuel-entry')}
				class="mt-4 inline-flex min-h-11 items-center justify-center rounded-xl bg-accent px-5 py-3 text-sm font-semibold text-accent-foreground no-underline"
			>
				Go to Fuel Entry
			</a>
		</section>
	{/if}

	{#if settingsOpen}
		<section
			id={settingsPanelId}
			aria-labelledby="export-settings-heading"
			class="space-y-5 rounded-2xl border border-border bg-card p-5 shadow-sm"
		>
			<div class="space-y-1">
				<h2 id="export-settings-heading" class="text-lg font-semibold text-foreground">Settings</h2>
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
					<div class="space-y-1">
						<label for="settings-currency" class="text-sm font-medium text-foreground">
							Currency prefix
						</label>
						<p id={currencyHelpId} class="text-sm text-muted-foreground">
							Choose a preset or enter a custom value such as `EUR `.
						</p>
					</div>

					<div class="flex flex-wrap gap-2">
						{#each PRESET_CURRENCIES as presetCurrency (presetCurrency)}
							<button
								type="button"
								onclick={() => handlePresetCurrencySelect(presetCurrency)}
								aria-pressed={settingsCurrency === presetCurrency}
								class="inline-flex min-h-11 items-center justify-center rounded-xl border border-border px-4 text-sm font-semibold text-foreground transition-colors hover:bg-muted/60"
							>
								{presetCurrency}
							</button>
						{/each}
					</div>

					<input
						id="settings-currency"
						bind:value={settingsCurrency}
						type="text"
						inputmode="text"
						oninput={handleCurrencyInput}
						aria-invalid={currencyError ? 'true' : undefined}
						aria-describedby={currencyError
							? `${currencyHelpId} ${currencyErrorId}`
							: currencyHelpId}
						class="block h-[52px] w-full rounded-xl border border-border px-3 py-2 text-base focus:outline-none focus:ring-2 focus:ring-ring"
					/>

					{#if currencyError}
						<p id={currencyErrorId} role="alert" class="text-sm text-destructive">
							{currencyError}
						</p>
					{/if}
				</div>

				<div class="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4">
					<a
						href={`#${exportSectionId}`}
						class="text-sm font-medium text-accent underline underline-offset-4"
					>
						Export all data
					</a>

					<button
						type="submit"
						class="inline-flex min-h-11 items-center justify-center rounded-xl bg-accent px-5 py-3 text-sm font-semibold text-accent-foreground"
					>
						Save settings
					</button>
				</div>

				{#if settingsErrorMessage}
					<p role="alert" class="text-sm text-destructive">{settingsErrorMessage}</p>
				{:else if settingsStatusMessage}
					<p role="status" class="text-sm text-muted-foreground">{settingsStatusMessage}</p>
				{/if}
			</form>
		</section>
	{/if}
</div>
