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
	import { m } from '$lib/paraglide/messages';

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
		const scope =
			exportScope === 'all-vehicles' ? m.export_scope_all_vehicles() : (currentVehicle?.name ?? '');
		return scope
			? m.export_entry_summary_scoped({ count, scope })
			: m.export_entry_summary({ count });
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
				// AC6 (Story 9.2): getVehicleById is unfiltered, so a stored id pointing at an ARCHIVED
				// vehicle would otherwise resolve here. Treat it like a dangling id — drop the stored id
				// and fall through to recovery, which picks the first ACTIVE vehicle (getAllVehicles is
				// active-only). An archived vehicle is never a current car.
				if (!result.data.isArchived) {
					return result.data;
				}
				safeRemoveItem(VEHICLE_ID_STORAGE_KEY);
			} else if (result.error.code !== 'NOT_FOUND') {
				throw new Error('GET_FAILED');
			} else {
				safeRemoveItem(VEHICLE_ID_STORAGE_KEY);
			}
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

			// getAllFuelLogs()/getAllExpenses() return rows for EVERY vehicle incl. archived, but
			// `allVehicles` is the active-only set — restrict the "all vehicles" export to active
			// vehicles' rows so an archived car's history never surfaces in an active-scoped export (AC5).
			const activeVehicleIds = new Set(allVehicles.map((v) => v.id));
			historyEntries = mergeHistoryEntries(
				(fuelResult.data ?? []).filter((entry) => activeVehicleIds.has(entry.vehicleId)),
				(expenseResult.data ?? []).filter((entry) => activeVehicleIds.has(entry.vehicleId))
			);
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
			errorMessage = m.export_error_prepare();
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
			errorMessage = m.export_error_prepare();
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

				// Active-only export (AC5): allVehicles is the active set, so drop any archived vehicle's
				// retained rows before they reach the CSV — mirrors loadEntriesForScope's summary filter.
				const activeVehicleIds = new Set(allVehicles.map((v) => v.id));
				nextEntries = mergeHistoryEntries(
					(fuelResult.data ?? []).filter((entry) => activeVehicleIds.has(entry.vehicleId)),
					(expenseResult.data ?? []).filter((entry) => activeVehicleIds.has(entry.vehicleId))
				);
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
			errorMessage = m.export_error_export();
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
	<title>{m.export_page_title()} | passanger</title>
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
				{m.export_intro()}
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
			<legend class="text-sm font-medium text-foreground">{m.export_scope_legend()}</legend>
			<div
				class="flex rounded-2xl bg-muted/50 p-1"
				role="radiogroup"
				aria-label={m.export_scope_legend()}
			>
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
						{m.export_scope_current_vehicle()}
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
						{m.export_scope_all_vehicles()}
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
					<p class="text-sm text-muted-foreground">
						{m.export_date_range({ range: dateRangeSummary })}
					</p>
				{:else}
					<p class="text-lg font-semibold text-foreground">{m.export_csv_button()}</p>
					<p class="text-sm text-muted-foreground">{m.export_checking_history()}</p>
				{/if}
			</div>

			<button
				type="button"
				onclick={handleExport}
				disabled={exportButtonDisabled}
				aria-busy={exporting ? 'true' : undefined}
				class="inline-flex min-h-11 items-center justify-center rounded-xl bg-accent px-5 py-3 text-sm font-semibold text-accent-foreground disabled:cursor-not-allowed disabled:opacity-70"
			>
				{exporting ? m.export_csv_button_busy() : m.export_csv_button()}
			</button>
		</section>
	{:else if !loading && !errorMessage}
		<section
			id={exportSectionId}
			aria-label={m.export_empty_state_label()}
			class="rounded-2xl border border-dashed border-border bg-card px-4 py-8 text-center"
		>
			<p class="text-base font-semibold text-foreground">
				{m.export_empty_title()}
			</p>
			<p class="mt-2 text-sm text-muted-foreground">
				{m.export_empty_body()}
			</p>
			<!-- eslint-disable svelte/no-navigation-without-resolve -- the path part IS resolve('/'); only the
			     `?capture=fuel` query string (which base-path resolution never touches) is appended. -->
			<a
				href={resolve('/') + '?capture=fuel'}
				class="mt-4 inline-flex min-h-11 items-center justify-center rounded-xl bg-accent px-5 py-3 text-sm font-semibold text-accent-foreground no-underline"
			>
				{m.export_empty_cta()}
			</a>
			<!-- eslint-enable svelte/no-navigation-without-resolve -->
		</section>
	{/if}

	<!-- Import entry point — always visible regardless of export state -->
	<section class="rounded-2xl border border-dashed border-border bg-card px-4 py-6 text-center">
		<p class="text-base font-semibold text-foreground">{m.export_import_cta_title()}</p>
		<p class="mt-1 text-sm text-muted-foreground">
			{m.export_import_cta_body()}
		</p>
		<a
			href={resolve('/import')}
			class="mt-4 inline-flex min-h-11 items-center justify-center rounded-xl border border-border bg-card px-5 py-3 text-sm font-semibold text-foreground no-underline"
		>
			{m.export_import_cta_link()}
		</a>
	</section>
</div>
