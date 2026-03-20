<script lang="ts">
	import type {
		ImportRow,
		ImportDryRunSummary,
		ImportSource,
		ImportParseResult,
		DetectedUnits
	} from '$lib/utils/importTypes';
	import type { AppError, Result } from '$lib/utils/result';
	import { ok, err } from '$lib/utils/result';

	type ParseState =
		| { status: 'idle' }
		| { status: 'loading' }
		| { status: 'success'; data: ImportParseResult }
		| { status: 'error'; error: AppError };

	interface ImportStepMappingProps {
		rawCSV: string;
		confirmedFormat: ImportSource;
		onMappingConfirmed: (data: { rows: ImportRow[]; summary: ImportDryRunSummary }) => void;
	}

	let { rawCSV, confirmedFormat, onMappingConfirmed }: ImportStepMappingProps = $props();

	let parseState = $state<ParseState>({ status: 'idle' });
	let fuelUnitOverride = $state<'L' | 'gal' | null>(null);
	let distanceUnitOverride = $state<'km' | 'mi' | null>(null);
	let showIgnored = $state(false);

	// Drivvo unit selection state (required before parsing)
	let drivvoFuelUnit = $state<'L' | 'gal' | ''>('');
	let drivvoDistanceUnit = $state<'km' | 'mi' | ''>('');

	const isDrivvo = $derived(confirmedFormat === 'drivvo');
	const drivvoUnitsSelected = $derived(drivvoFuelUnit !== '' && drivvoDistanceUnit !== '');

	const canContinue = $derived(
		parseState.status === 'success' && (!isDrivvo || drivvoUnitsSelected)
	);

	const effectiveUnits = $derived.by(() => {
		if (parseState.status !== 'success') return null;
		const detected = parseState.data.detectedUnits;
		if (isDrivvo) {
			// Drivvo: units come from user selection
			return {
				fuel: (drivvoFuelUnit || 'L') as 'L' | 'gal',
				distance: (drivvoDistanceUnit || 'km') as 'km' | 'mi'
			};
		}
		if (!detected) return null;
		return {
			fuel: fuelUnitOverride ?? detected.fuel,
			distance: distanceUnitOverride ?? detected.distance
		};
	});

	function formatDate(date: Date | undefined): string {
		if (!date || !(date instanceof Date) || isNaN(date.getTime())) return '—';
		return date.toLocaleDateString('en', { year: 'numeric', month: 'short', day: 'numeric' });
	}

	function formatNumber(value: number | undefined, decimals = 2): string {
		if (value == null || isNaN(value)) return '—';
		return value.toLocaleString('en', {
			minimumFractionDigits: decimals,
			maximumFractionDigits: decimals
		});
	}

	function getEntryTypeLabel(type: string | undefined): string {
		if (type === 'fuel') return 'Fuel';
		if (type === 'maintenance') return 'Service';
		return '';
	}

	/**
	 * Parser dispatch — calls the correct parser based on format.
	 */
	async function parseForFormat(
		format: ImportSource,
		csv: string,
		userUnits?: DetectedUnits
	): Promise<Result<ImportParseResult>> {
		switch (format) {
			case 'fuelly': {
				const { parseFuellyCSV } = await import('$lib/utils/importParseFuelly');
				const result = await parseFuellyCSV(csv);
				if (result.error) return result;
				return ok({
					rows: result.data.rows,
					summary: result.data.summary,
					detectedUnits: result.data.detectedUnits,
					columnMapping: result.data.columnMapping
				});
			}
			case 'acar': {
				const { parseACarCSV } = await import('$lib/utils/importParseACar');
				return parseACarCSV(csv);
			}
			case 'drivvo': {
				if (!userUnits) return err('PARSE_FAILED', 'Units must be selected before parsing.');
				const { parseDrivvoCSV } = await import('$lib/utils/importParseDrivvo');
				return parseDrivvoCSV(csv, userUnits);
			}
			default:
				return err('PARSE_FAILED', 'This format is not yet supported.');
		}
	}

	function handleContinue() {
		if (parseState.status !== 'success') return;
		const units = effectiveUnits;
		const detected = parseState.data.detectedUnits;
		let rows = parseState.data.rows;

		// Apply unit overrides to row data
		if (isDrivvo && units) {
			// Drivvo: units come from user selection (already set during parse)
			// But ensure all rows reflect the selected units
			rows = rows.map((row) => ({
				...row,
				data: {
					...row.data,
					unit: units.fuel,
					distanceUnit: units.distance
				}
			}));
		} else if (
			units &&
			detected &&
			(units.fuel !== detected.fuel || units.distance !== detected.distance)
		) {
			rows = rows.map((row) => ({
				...row,
				data: {
					...row.data,
					unit: units.fuel,
					distanceUnit: units.distance
				}
			}));
		}

		onMappingConfirmed({
			rows,
			summary: parseState.data.summary
		});
	}

	let cleanupDrivvoParse: (() => void) | null = null;

	function handleDrivvoParse() {
		if (!drivvoUnitsSelected || !rawCSV) return;
		cleanupDrivvoParse?.();
		const userUnits: DetectedUnits = {
			fuel: drivvoFuelUnit as 'L' | 'gal',
			distance: drivvoDistanceUnit as 'km' | 'mi'
		};
		cleanupDrivvoParse = runParse(userUnits) ?? null;
	}

	function runParse(userUnits?: DetectedUnits) {
		let cancelled = false;
		parseState = { status: 'loading' };
		parseForFormat(confirmedFormat, rawCSV, userUnits).then((result) => {
			if (cancelled) return;
			if (result.error) {
				parseState = { status: 'error', error: result.error };
			} else {
				parseState = { status: 'success', data: result.data };
			}
		});
		return () => {
			cancelled = true;
		};
	}

	// Auto-parse for Fuelly and aCar (not Drivvo — needs unit selection first)
	$effect(() => {
		if ((confirmedFormat === 'fuelly' || confirmedFormat === 'acar') && rawCSV) {
			return runParse();
		}
	});

	function getFormatLabel(): string {
		switch (confirmedFormat) {
			case 'fuelly':
				return 'Fuelly';
			case 'acar':
				return 'aCar/Fuelio';
			case 'drivvo':
				return 'Drivvo';
			default:
				return 'CSV';
		}
	}
</script>

{#if isDrivvo && parseState.status === 'idle'}
	<!-- Drivvo: unit selection required before parsing -->
	<div class="space-y-4">
		<div class="rounded-2xl border border-border bg-card p-5 shadow-sm">
			<p class="text-sm text-foreground">What units does your data use?</p>
			<p class="mt-1 text-xs text-muted-foreground">
				Drivvo files don't include unit information — please select the units your data uses.
			</p>
			<div class="mt-3 flex gap-4">
				<label class="flex flex-col gap-1">
					<span class="text-xs text-muted-foreground">Fuel unit</span>
					<select
						class="rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground"
						value={drivvoFuelUnit}
						onchange={(e) => {
							drivvoFuelUnit = (e.target as HTMLSelectElement).value as 'L' | 'gal' | '';
						}}
					>
						<option value="" disabled>Select...</option>
						<option value="L">L</option>
						<option value="gal">gal</option>
					</select>
				</label>
				<label class="flex flex-col gap-1">
					<span class="text-xs text-muted-foreground">Distance</span>
					<select
						class="rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground"
						value={drivvoDistanceUnit}
						onchange={(e) => {
							drivvoDistanceUnit = (e.target as HTMLSelectElement).value as 'km' | 'mi' | '';
						}}
					>
						<option value="" disabled>Select...</option>
						<option value="km">km</option>
						<option value="mi">mi</option>
					</select>
				</label>
			</div>
		</div>
		<button
			type="button"
			disabled={!drivvoUnitsSelected}
			class="inline-flex min-h-11 items-center justify-center rounded-xl bg-accent px-5 py-3 text-sm font-semibold text-accent-foreground disabled:cursor-not-allowed disabled:opacity-70"
			onclick={handleDrivvoParse}
		>
			Parse data
		</button>
	</div>
{/if}

{#if parseState.status === 'loading' || (parseState.status === 'idle' && !isDrivvo)}
	<div
		class="flex items-center justify-center gap-3 rounded-2xl border border-border bg-card p-6"
		role="status"
	>
		<div
			class="h-5 w-5 animate-spin rounded-full border-2 border-accent border-t-transparent"
		></div>
		<p class="text-sm text-muted-foreground">Parsing your data...</p>
	</div>
{/if}

{#if parseState.status === 'error'}
	<div
		role="alert"
		class="space-y-3 rounded-2xl border border-destructive/20 bg-destructive/10 p-4"
	>
		<p class="text-sm font-semibold text-destructive">Could not parse file</p>
		<p class="text-sm text-destructive">{parseState.error.message}</p>
		<p class="text-sm text-muted-foreground">
			Try re-uploading your {getFormatLabel()} export file.
		</p>
	</div>
{/if}

{#if parseState.status === 'success'}
	{@const { columnMapping, detectedUnits, rows, summary } = parseState.data}
	{@const mapped = columnMapping.filter((m) => m.status !== 'ignored')}
	{@const ignored = columnMapping.filter((m) => m.status === 'ignored')}
	{@const previewRows = rows.slice(0, 3)}
	{@const hasMixedTypes =
		rows.some((r) => r.data.type === 'maintenance') && rows.some((r) => r.data.type === 'fuel')}

	<div class="space-y-4">
		<!-- Column mapping table -->
		<div class="rounded-2xl border border-border bg-card p-5 shadow-sm">
			<h3 class="mb-3 text-sm font-semibold text-foreground">Here's how we'll map your data</h3>
			<div class="space-y-2">
				{#each mapped as entry (entry.sourceColumn)}
					<div class="flex items-center justify-between rounded-lg bg-muted/40 px-3 py-2">
						<span class="text-sm text-muted-foreground">{entry.sourceColumn}</span>
						<span class="mx-2 text-xs text-muted-foreground">→</span>
						<span class="text-sm font-medium text-foreground">{entry.targetField}</span>
						{#if entry.status === 'calculated'}
							<span
								class="ml-2 inline-flex items-center rounded-full bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-800 dark:bg-blue-900/30 dark:text-blue-400"
								>calc</span
							>
						{:else}
							<span
								class="ml-2 inline-flex items-center rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-800 dark:bg-green-900/30 dark:text-green-400"
								aria-label="mapped"
							>
								&#10003;
							</span>
						{/if}
					</div>
				{/each}
			</div>

			{#if ignored.length > 0}
				<button
					type="button"
					class="mt-3 text-xs text-muted-foreground underline"
					onclick={() => (showIgnored = !showIgnored)}
				>
					{showIgnored ? 'Hide' : 'Show'}
					{ignored.length} ignored columns
				</button>

				{#if showIgnored}
					<div class="mt-2 space-y-1">
						{#each ignored as entry (entry.sourceColumn)}
							<div class="flex items-center justify-between rounded-lg bg-muted/20 px-3 py-1.5">
								<span class="text-xs text-muted-foreground">{entry.sourceColumn}</span>
								<span class="text-xs text-muted-foreground">—</span>
							</div>
						{/each}
					</div>
				{/if}
			{/if}
		</div>

		<!-- Unit confirmation -->
		<div class="rounded-2xl border border-border bg-card p-5 shadow-sm">
			{#if isDrivvo}
				<p class="text-sm text-foreground">
					Units: <strong>{drivvoFuelUnit === 'L' ? 'litres' : 'gallons'}</strong>
					and <strong>{drivvoDistanceUnit}</strong> (selected above)
				</p>
			{:else if confirmedFormat === 'acar' && detectedUnits}
				<p class="text-sm text-foreground">
					Your file declares <strong>{detectedUnits.fuel === 'L' ? 'litres' : 'gallons'}</strong>
					and <strong>{detectedUnits.distance === 'km' ? 'km' : 'miles'}</strong>. Correct?
				</p>
			{:else if detectedUnits}
				<p class="text-sm text-foreground">
					Your file uses <strong>{detectedUnits.fuel === 'L' ? 'litres' : 'gallons'}</strong>
					and <strong>{detectedUnits.distance === 'km' ? 'km' : 'miles'}</strong>. Correct?
				</p>
			{/if}
			{#if !isDrivvo && detectedUnits}
				<div class="mt-3 flex gap-4">
					<label class="flex flex-col gap-1">
						<span class="text-xs text-muted-foreground">Fuel unit</span>
						<select
							class="rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground"
							value={effectiveUnits?.fuel ?? detectedUnits.fuel}
							onchange={(e) => {
								fuelUnitOverride = (e.target as HTMLSelectElement).value as 'L' | 'gal';
							}}
						>
							<option value="L">L</option>
							<option value="gal">gal</option>
						</select>
					</label>
					<label class="flex flex-col gap-1">
						<span class="text-xs text-muted-foreground">Distance</span>
						<select
							class="rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground"
							value={effectiveUnits?.distance ?? detectedUnits.distance}
							onchange={(e) => {
								distanceUnitOverride = (e.target as HTMLSelectElement).value as 'km' | 'mi';
							}}
						>
							<option value="km">km</option>
							<option value="mi">mi</option>
						</select>
					</label>
				</div>
			{/if}
		</div>

		<!-- Price note — Fuelly only (aCar/Drivvo use total cost directly) -->
		{#if confirmedFormat === 'fuelly'}
			<div class="rounded-2xl border border-blue-500/20 bg-blue-500/10 p-4">
				<p class="text-sm text-blue-700 dark:text-blue-400">
					Total cost calculated as price &times; quantity
				</p>
			</div>
		{/if}

		<!-- Data preview cards -->
		<div class="space-y-2">
			<h3 class="text-sm font-semibold text-foreground">Data preview</h3>
			{#each previewRows as row (row.rowNumber)}
				<div class="rounded-xl border border-border bg-card px-4 py-3">
					<p class="text-sm text-foreground">
						<span class="font-medium">Row {row.rowNumber}:</span>
						{#if hasMixedTypes}
							<span
								class="mr-1 inline-flex items-center rounded-full bg-muted px-1.5 py-0.5 text-xs font-medium text-muted-foreground"
								>{getEntryTypeLabel(row.data.type)}</span
							>
						{/if}
						{formatDate(row.data.date)} · {formatNumber(row.data.odometer, 0)}
						{effectiveUnits?.distance ?? 'km'}
						{#if row.data.type === 'fuel'}
							· {formatNumber(row.data.quantity, 2)}
							{effectiveUnits?.fuel ?? 'L'} · {formatNumber(row.data.totalCost)}
						{:else}
							· {formatNumber(row.data.totalCost)}
							{#if row.data.maintenanceType}
								({row.data.maintenanceType})
							{/if}
						{/if}
					</p>
					{#if row.data.sourceVehicleName}
						<p class="mt-0.5 text-xs text-muted-foreground">
							{row.data.sourceVehicleName}
						</p>
					{/if}
				</div>
			{/each}
		</div>

		<!-- Dry-run summary strip -->
		<div
			class="rounded-xl border border-border bg-muted/50 px-4 py-3"
			data-testid="dry-run-summary"
		>
			<p class="text-sm text-foreground">
				{summary.totalRows} rows: {summary.validCount} ready{#if summary.warningCount > 0}, {summary.warningCount}
					warnings{/if}{#if summary.errorCount > 0}, {summary.errorCount} errors{/if}
				{#if summary.detectedVehicleNames.length > 0}
					· {summary.detectedVehicleNames.length} vehicle{summary.detectedVehicleNames.length !== 1
						? 's'
						: ''} detected
				{/if}
			</p>
		</div>

		<!-- Continue button -->
		<button
			type="button"
			disabled={!canContinue}
			class="inline-flex min-h-11 items-center justify-center rounded-xl bg-accent px-5 py-3 text-sm font-semibold text-accent-foreground disabled:cursor-not-allowed disabled:opacity-70"
			onclick={handleContinue}
		>
			Continue
		</button>
	</div>
{/if}
