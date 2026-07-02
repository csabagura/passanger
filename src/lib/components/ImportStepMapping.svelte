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
	import { formatImportDateRange } from '$lib/utils/importSummary';
	import { formatCurrency } from '$lib/utils/calculations';
	import { getSettings } from '$lib/utils/settings';
	import { DEFAULT_CURRENCY } from '$lib/config';
	import { m } from '$lib/paraglide/messages';

	// Home currency, resolved EXACTLY as commitImportRows does (importCommit.ts:26) so the
	// preview can never claim a different currency than the commit writes. Imported rows carry
	// no currency metadata, so they adopt this on commit (per-row currency import is deferred).
	const homeCurrency = getSettings().currency || DEFAULT_CURRENCY;

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

	// "How we mapped this" disclosure. Default-collapsed (AC2) — the mapping/units are an optional
	// verify/override fallback now, not a mandatory wall. It auto-opens only when detection was
	// incomplete (the file carried no units → detectedUnits is null, i.e. Drivvo), nudging the user
	// to confirm the units they had to supply. The effect runs once on the parse→success transition
	// (parseState is its only dep), so manual toggles afterwards are preserved.
	let mappingDisclosureOpen = $state(false);
	$effect(() => {
		if (parseState.status === 'success') {
			mappingDisclosureOpen = parseState.data.detectedUnits === null;
		}
	});

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
		if (type === 'fuel') return m.common_fuel();
		if (type === 'maintenance') return m.import_entry_type_service();
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
				if (!userUnits) return err('PARSE_FAILED', m.import_mapping_error_units_required());
				const { parseDrivvoCSV } = await import('$lib/utils/importParseDrivvo');
				return parseDrivvoCSV(csv, userUnits);
			}
			default:
				return err('PARSE_FAILED', m.import_mapping_error_unsupported());
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
			<p class="text-sm text-foreground">{m.import_mapping_drivvo_units_q()}</p>
			<p class="mt-1 text-xs text-muted-foreground">
				{m.import_mapping_drivvo_units_help()}
			</p>
			<div class="mt-3 flex gap-4">
				<label class="flex flex-col gap-1">
					<span class="text-xs text-muted-foreground">{m.import_mapping_fuel_unit()}</span>
					<select
						class="min-h-11 rounded-lg border border-border bg-background px-3 py-2 text-base text-foreground"
						value={drivvoFuelUnit}
						onchange={(e) => {
							drivvoFuelUnit = (e.target as HTMLSelectElement).value as 'L' | 'gal' | '';
						}}
					>
						<option value="" disabled>{m.import_mapping_select_placeholder()}</option>
						<option value="L">L</option>
						<option value="gal">gal</option>
					</select>
				</label>
				<label class="flex flex-col gap-1">
					<span class="text-xs text-muted-foreground">{m.import_mapping_distance()}</span>
					<select
						class="min-h-11 rounded-lg border border-border bg-background px-3 py-2 text-base text-foreground"
						value={drivvoDistanceUnit}
						onchange={(e) => {
							drivvoDistanceUnit = (e.target as HTMLSelectElement).value as 'km' | 'mi' | '';
						}}
					>
						<option value="" disabled>{m.import_mapping_select_placeholder()}</option>
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
			{m.import_mapping_parse_button()}
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
		<p class="text-sm text-muted-foreground">{m.import_mapping_parsing()}</p>
	</div>
{/if}

{#if parseState.status === 'error'}
	<div
		role="alert"
		class="space-y-3 rounded-2xl border border-destructive/20 bg-destructive/10 p-4"
	>
		<p class="text-sm font-semibold text-destructive">{m.import_mapping_error_title()}</p>
		<p class="text-sm text-destructive">{parseState.error.message}</p>
		<p class="text-sm text-muted-foreground">
			{m.import_mapping_error_retry({ format: getFormatLabel() })}
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
	<!-- Count/split/total reflect ONLY committable rows (valid|warning) so the value-first preview
	     promises exactly what commitImportRows writes — error rows are excluded at commit, so they
	     must not inflate the headline or total spend (mirrors the home-currency fidelity above). -->
	{@const committable = rows.filter((r) => r.status === 'valid' || r.status === 'warning')}
	{@const fuelCount = committable.filter((r) => r.data.type === 'fuel').length}
	{@const expenseCount = committable.filter((r) => r.data.type === 'maintenance').length}
	{@const totalSpend = committable.reduce(
		(sum, r) => sum + (Number.isFinite(r.data.totalCost) ? (r.data.totalCost as number) : 0),
		0
	)}
	<!-- splitText: a comma-separated LIST of two complete count phrases (fuel-ups, expenses), each a
	     plural message; the ', ' is a list separator, not sentence glue. FLAGGED (list-join). -->
	{@const splitText =
		(fuelCount > 0 ? m.import_preview_fuelups({ count: fuelCount }) : '') +
		(fuelCount > 0 && expenseCount > 0 ? ', ' : '') +
		(expenseCount > 0 ? m.import_preview_expenses({ count: expenseCount }) : '')}
	{@const dateRangeText = formatImportDateRange(summary.dateRange)}
	<!-- headline: pick the spanning vs count-only variant (each a plural message) so the date span
	     (a date-seam RESULT) is passed as a param, never concatenated as a translated fragment. -->
	{@const headline = dateRangeText
		? m.import_preview_headline_spanning({ count: committable.length, range: dateRangeText })
		: m.import_preview_headline({ count: committable.length })}

	<div class="space-y-4">
		<!-- Value-first preview — the primary content of the Preview step (AC1) -->
		<div
			class="rounded-2xl border border-border bg-card p-5 shadow-sm"
			data-testid="import-preview"
		>
			<h3 class="text-base font-semibold text-foreground">{headline}</h3>
			{#if splitText}
				<p class="mt-2 text-sm text-muted-foreground">{splitText}</p>
			{/if}
			<p class="mt-1 text-sm text-foreground">
				{m.import_preview_total_spend()}
				<span class="font-semibold">{formatCurrency(totalSpend, homeCurrency)}</span>
			</p>
			<p class="mt-1 text-xs text-muted-foreground">
				{m.import_preview_amounts_in({ currency: homeCurrency })}
			</p>
		</div>

		<!-- Mapping + units demoted to an optional, default-collapsed disclosure (AC2). -->
		<details
			bind:open={mappingDisclosureOpen}
			class="rounded-2xl border border-border bg-card shadow-sm"
		>
			<summary
				class="cursor-pointer list-none px-5 py-4 text-sm font-semibold text-foreground [&::-webkit-details-marker]:hidden"
			>
				{m.import_mapping_disclosure_title()}
			</summary>
			<div class="space-y-4 px-5 pb-5">
				<!-- Column mapping table -->
				<div>
					<p class="mb-3 text-sm text-muted-foreground">{m.import_mapping_table_intro()}</p>
					<div class="space-y-2">
						{#each mapped as entry (entry.sourceColumn)}
							<div class="flex items-center justify-between rounded-lg bg-muted/40 px-3 py-2">
								<span class="text-sm text-muted-foreground">{entry.sourceColumn}</span>
								<span class="mx-2 text-xs text-muted-foreground">→</span>
								<span class="text-sm font-medium text-foreground">{entry.targetField}</span>
								{#if entry.status === 'calculated'}
									<span
										class="ml-2 inline-flex items-center rounded-full bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-800 dark:bg-blue-900/30 dark:text-blue-400"
										>{m.import_mapping_badge_calc()}</span
									>
								{:else}
									<span
										class="ml-2 inline-flex items-center rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-800 dark:bg-green-900/30 dark:text-green-400"
										aria-label={m.import_mapping_badge_mapped()}
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
							class="mt-3 inline-flex min-h-11 items-center text-xs text-muted-foreground underline"
							onclick={() => (showIgnored = !showIgnored)}
						>
							{showIgnored
								? m.import_mapping_ignored_hide({ count: ignored.length })
								: m.import_mapping_ignored_show({ count: ignored.length })}
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

				<!-- Unit confirmation / override (the units-fallback). The unit names (litres/gallons/km/
				     miles) are translatable display words derived from the unit VALUE; they are passed as
				     params into one whole-sentence template per variant (no fragment concatenation). -->
				<div class="border-t border-border pt-4">
					{#if isDrivvo}
						<p class="text-sm text-foreground">
							{m.import_mapping_units_drivvo({
								fuel: drivvoFuelUnit === 'L' ? m.import_unit_litres() : m.import_unit_gallons(),
								distance: drivvoDistanceUnit
							})}
						</p>
					{:else if confirmedFormat === 'acar' && detectedUnits}
						<p class="text-sm text-foreground">
							{m.import_mapping_units_declares({
								fuel: detectedUnits.fuel === 'L' ? m.import_unit_litres() : m.import_unit_gallons(),
								distance:
									detectedUnits.distance === 'km' ? m.import_unit_km() : m.import_unit_miles()
							})}
						</p>
					{:else if detectedUnits}
						<p class="text-sm text-foreground">
							{m.import_mapping_units_uses({
								fuel: detectedUnits.fuel === 'L' ? m.import_unit_litres() : m.import_unit_gallons(),
								distance:
									detectedUnits.distance === 'km' ? m.import_unit_km() : m.import_unit_miles()
							})}
						</p>
					{/if}
					{#if !isDrivvo && detectedUnits}
						<div class="mt-3 flex gap-4">
							<label class="flex flex-col gap-1">
								<span class="text-xs text-muted-foreground">{m.import_mapping_fuel_unit()}</span>
								<select
									class="min-h-11 rounded-lg border border-border bg-background px-3 py-2 text-base text-foreground"
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
								<span class="text-xs text-muted-foreground">{m.import_mapping_distance()}</span>
								<select
									class="min-h-11 rounded-lg border border-border bg-background px-3 py-2 text-base text-foreground"
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
							{m.import_mapping_price_note()}
						</p>
					</div>
				{/if}
			</div>
		</details>

		<!-- Data preview cards -->
		<div class="space-y-2">
			<h3 class="text-sm font-semibold text-foreground">{m.import_mapping_data_preview()}</h3>
			{#each previewRows as row (row.rowNumber)}
				<div class="rounded-xl border border-border bg-card px-4 py-3">
					<p class="text-sm text-foreground">
						<span class="font-medium">{m.import_mapping_row_label({ row: row.rowNumber })}</span>
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

		<!-- Dry-run summary strip — a status line of self-contained count clauses joined by punctuation
		     separators (": ", ", ", " · "), each a complete message; the conditional warnings/errors keep
		     the original fixed "warnings"/"errors" wording (NOT pluralised) so the headline stays stable.
		     FLAGGED (clause-list join). -->
		<div
			class="rounded-xl border border-border bg-muted/50 px-4 py-3"
			data-testid="dry-run-summary"
		>
			<p class="text-sm text-foreground">
				{m.import_preview_summary_rows({ total: summary.totalRows })}: {m.import_preview_summary_ready(
					{ count: summary.validCount }
				)}{#if summary.warningCount > 0}, {m.import_preview_summary_warnings({
						count: summary.warningCount
					})}{/if}{#if summary.errorCount > 0}, {m.import_preview_summary_errors({
						count: summary.errorCount
					})}{/if}
				{#if summary.detectedVehicleNames.length > 0}
					· {m.import_preview_summary_vehicles({ count: summary.detectedVehicleNames.length })}
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
			{m.import_continue()}
		</button>
	</div>
{/if}
