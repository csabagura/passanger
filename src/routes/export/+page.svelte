<script lang="ts">
	import { resolve } from '$app/paths';
	import { VEHICLE_ID_STORAGE_KEY } from '$lib/config';
	import { getAllExpenses } from '$lib/db/repositories/expenses';
	import { getAllFuelLogs } from '$lib/db/repositories/fuelLogs';
	import { getAllVehicles, getVehicleById } from '$lib/db/repositories/vehicles';
	import type { Vehicle } from '$lib/db/schema';
	import {
		buildCSVFilename,
		buildHistoryExportCSV,
		buildHistoryExportCSVWithVehicles,
		downloadCSV
	} from '$lib/utils/csv';
	import { formatLocalCalendarDate } from '$lib/utils/date';
	import { mergeHistoryEntries, type HistoryEntry } from '$lib/utils/historyEntries';
	import { readStoredVehicleId, safeRemoveItem, safeSetItem } from '$lib/utils/vehicleStorage';

	let currentVehicle = $state<Vehicle | null>(null);
	let allVehicles = $state<Vehicle[]>([]);
	let historyEntries = $state<HistoryEntry[]>([]);
	let loading = $state(true);
	let loadStarted = $state(false);
	let exporting = $state(false);
	let errorMessage = $state('');
	let exportScope = $state<'current-vehicle' | 'all-vehicles'>('current-vehicle');

	const exportSectionId = 'export-route-primary-action';

	const showScopeSelector = $derived(allVehicles.length > 1);
	const hasEntries = $derived(historyEntries.length > 0);
	const showExportActionCard = $derived(hasEntries || (loading && !errorMessage));
	const exportButtonDisabled = $derived(exporting || loading || !currentVehicle || !hasEntries);
	const entrySummary = $derived.by(() => {
		const count = historyEntries.length;
		const label = count === 1 ? 'entry' : 'entries';
		const scope = exportScope === 'all-vehicles' ? 'All vehicles' : (currentVehicle?.name ?? '');
		return scope ? `${count} ${label} ready (${scope})` : `${count} ${label} ready`;
	});
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

	async function loadEntriesForScope(): Promise<void> {
		if (!currentVehicle) {
			historyEntries = [];
			return;
		}

		if (exportScope === 'all-vehicles' && allVehicles.length > 1) {
			const [fuelResult, expenseResult] = await Promise.all([getAllFuelLogs(), getAllExpenses()]);

			if (fuelResult.error || expenseResult.error) {
				throw new Error('GET_FAILED');
			}

			historyEntries = mergeHistoryEntries(fuelResult.data ?? [], expenseResult.data ?? []);
		} else {
			const [fuelResult, expenseResult] = await Promise.all([
				getAllFuelLogs(currentVehicle.id),
				getAllExpenses(currentVehicle.id)
			]);

			if (fuelResult.error || expenseResult.error) {
				throw new Error('GET_FAILED');
			}

			historyEntries = mergeHistoryEntries(fuelResult.data ?? [], expenseResult.data ?? []);
		}
	}

	async function loadExportPage(): Promise<void> {
		loading = true;
		errorMessage = '';
		currentVehicle = null;
		allVehicles = [];
		historyEntries = [];

		try {
			const vehicle = await resolveCurrentVehicle();
			currentVehicle = vehicle;

			if (!vehicle) {
				return;
			}

			const vehiclesResult = await getAllVehicles();
			if (!vehiclesResult.error && vehiclesResult.data) {
				allVehicles = vehiclesResult.data;
				if (allVehicles.length > 1) {
					exportScope = 'all-vehicles';
				} else {
					exportScope = 'current-vehicle';
				}
			}

			await loadEntriesForScope();
		} catch {
			errorMessage = 'Could not prepare your export. Please try again.';
			historyEntries = [];
		} finally {
			loading = false;
		}
	}

	async function handleScopeChange(): Promise<void> {
		if (loading || !currentVehicle) {
			return;
		}

		loading = true;
		errorMessage = '';

		try {
			await loadEntriesForScope();
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
			let nextEntries: HistoryEntry[];

			if (exportScope === 'all-vehicles' && allVehicles.length > 1) {
				const [fuelResult, expenseResult] = await Promise.all([getAllFuelLogs(), getAllExpenses()]);

				if (fuelResult.error || expenseResult.error) {
					throw new Error('GET_FAILED');
				}

				nextEntries = mergeHistoryEntries(fuelResult.data ?? [], expenseResult.data ?? []);
				historyEntries = nextEntries;

				if (nextEntries.length === 0) {
					return;
				}

				const vehicleNameMap = new Map(allVehicles.map((v) => [v.id ?? 0, v.name]));
				const content = buildHistoryExportCSVWithVehicles(nextEntries, vehicleNameMap);
				const filename = buildCSVFilename(new Date());
				downloadCSV(content, filename);
			} else {
				const [fuelResult, expenseResult] = await Promise.all([
					getAllFuelLogs(currentVehicle.id),
					getAllExpenses(currentVehicle.id)
				]);

				if (fuelResult.error || expenseResult.error) {
					throw new Error('GET_FAILED');
				}

				nextEntries = mergeHistoryEntries(fuelResult.data ?? [], expenseResult.data ?? []);
				historyEntries = nextEntries;

				if (nextEntries.length === 0) {
					return;
				}

				const content = buildHistoryExportCSV(nextEntries);
				const filename = buildCSVFilename(new Date());
				downloadCSV(content, filename);
			}
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

<svelte:head>
	<title>Export | passanger</title>
</svelte:head>

<div class="space-y-6 px-4 pt-4">
	<header class="space-y-1">
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
	</header>

	{#if errorMessage}
		<div role="alert" class="rounded-2xl border border-destructive/20 bg-destructive/10 p-4">
			<p class="text-sm text-destructive">{errorMessage}</p>
		</div>
	{/if}

	{#if showScopeSelector}
		<fieldset class="space-y-3">
			<legend class="text-sm font-medium text-foreground">Export scope</legend>
			<div class="flex rounded-2xl bg-muted/50 p-1" role="radiogroup" aria-label="Export scope">
				<label class="flex-1">
					<input
						bind:group={exportScope}
						class="peer sr-only"
						name="export-scope"
						type="radio"
						value="current-vehicle"
						onchange={handleScopeChange}
					/>
					<span
						class="flex min-h-11 items-center justify-center rounded-xl border border-transparent px-4 text-sm font-medium text-muted-foreground transition-colors peer-checked:bg-accent peer-checked:text-accent-foreground peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-accent"
					>
						Current vehicle
					</span>
				</label>
				<label class="flex-1">
					<input
						bind:group={exportScope}
						class="peer sr-only"
						name="export-scope"
						type="radio"
						value="all-vehicles"
						onchange={handleScopeChange}
					/>
					<span
						class="flex min-h-11 items-center justify-center rounded-xl border border-transparent px-4 text-sm font-medium text-muted-foreground transition-colors peer-checked:bg-accent peer-checked:text-accent-foreground peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-accent"
					>
						All vehicles
					</span>
				</label>
			</div>
		</fieldset>
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
				href={resolve('/log')}
				class="mt-4 inline-flex min-h-11 items-center justify-center rounded-xl bg-accent px-5 py-3 text-sm font-semibold text-accent-foreground no-underline"
			>
				Go to Log
			</a>
		</section>
	{/if}

	<!-- Import entry point — always visible regardless of export state -->
	<section class="rounded-2xl border border-dashed border-border bg-card px-4 py-6 text-center">
		<p class="text-base font-semibold text-foreground">Switching from another app?</p>
		<p class="mt-1 text-sm text-muted-foreground">
			Bring your history from Fuelly, aCar, Drivvo, or any CSV export.
		</p>
		<a
			href={resolve('/import')}
			class="mt-4 inline-flex min-h-11 items-center justify-center rounded-xl border border-border bg-card px-5 py-3 text-sm font-semibold text-foreground no-underline"
		>
			Import data from another app
		</a>
	</section>
</div>
