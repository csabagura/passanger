<script lang="ts">
	import { getContext } from 'svelte';
	import { resolve } from '$app/paths';
	import { goto } from '$app/navigation';
	import { commitImportRows } from '$lib/utils/importCommit';
	import { findDuplicateRows } from '$lib/utils/importDuplicates';
	import { formatImportDateRange } from '$lib/utils/importSummary';
	import type {
		ImportRow,
		ImportDryRunSummary,
		VehicleAssignment,
		ImportCommitResult
	} from '$lib/utils/importTypes';
	import type { AppError } from '$lib/utils/result';
	import type { VehiclesContext } from '$lib/utils/vehicleContext';
	import { m } from '$lib/paraglide/messages';

	type AsyncState<T> =
		| { status: 'idle' }
		| { status: 'loading' }
		| { status: 'success'; data: T }
		| { status: 'error'; error: AppError };

	interface ImportStepConfirmProps {
		rows: ImportRow[];
		summary: ImportDryRunSummary;
		assignments: VehicleAssignment[];
		// Story 8.3 AC2 (H9) — rows the Review step already skipped (buildFinalRows removed them from
		// `rows` before this component ever saw them); folded into externalSkippedCount below.
		reviewSkippedCount: number;
		onImportComplete: (result: ImportCommitResult) => void;
		onImportReset: () => void;
	}

	let {
		rows,
		summary,
		assignments,
		reviewSkippedCount,
		onImportComplete,
		onImportReset
	}: ImportStepConfirmProps = $props();

	const vehiclesContext = getContext<VehiclesContext>('vehicles');

	let commitState = $state<AsyncState<ImportCommitResult>>({ status: 'idle' });
	let progressCurrent = $state(0);
	let progressTotal = $state(0);

	// Story 8.3 AC1 (H7) — rows destined for an EXISTING vehicle are checked against that vehicle's
	// already-persisted fuelLogs before the final commit trigger. 'checking' while the async DB read
	// runs, 'none' when nothing matched (or the check itself failed — fail open rather than block
	// import on an advisory check), 'pending' while awaiting the user's keep/skip choice, 'keep'/'skip'
	// once decided. Rows assigned to a NEW vehicle are never included (checked inside findDuplicateRows).
	let duplicateState = $state<'checking' | 'none' | 'pending' | 'keep' | 'skip'>('checking');
	let duplicateRowNumbers = $state<Set<number>>(new Set());

	(async () => {
		const result = await findDuplicateRows(rows, assignments);
		if (result.error || result.data.duplicateRowNumbers.size === 0) {
			duplicateState = 'none';
			return;
		}
		duplicateRowNumbers = result.data.duplicateRowNumbers;
		duplicateState = 'pending';
	})();

	// The rows actually offered to commit — excludes duplicate-skipped rows once the user chooses
	// to skip them. AC2's final skippedCount reconciliation is fed via externalSkippedCount below,
	// not by a second parallel skip-counting mechanism.
	const effectiveRows = $derived(
		duplicateState === 'skip' ? rows.filter((r) => !duplicateRowNumbers.has(r.rowNumber)) : rows
	);
	const externalSkippedCount = $derived(
		(duplicateState === 'skip' ? duplicateRowNumbers.size : 0) + reviewSkippedCount
	);

	const importableRows = $derived(
		effectiveRows.filter((r) => r.status === 'valid' || r.status === 'warning')
	);
	const skippedRows = $derived(effectiveRows.filter((r) => r.status === 'error'));
	const correctedCount = $derived(effectiveRows.filter((r) => r.status === 'warning').length);
	let showSkipped = $state(false);

	const newVehicleAssignments = $derived(assignments.filter((a) => a.assignmentType === 'new'));

	function getVehicleBreakdown(): Array<{ name: string; count: number; isNew: boolean }> {
		const breakdown: Array<{ name: string; count: number; isNew: boolean }> = [];
		for (const assignment of assignments) {
			const isNew = assignment.assignmentType === 'new';
			const name = isNew
				? (assignment.newVehicle?.name ?? assignment.sourceVehicleName)
				: (vehiclesContext.vehicles.find((v) => v.id === assignment.existingVehicleId)?.name ??
					assignment.sourceVehicleName);
			breakdown.push({ name, count: assignment.rowCount, isNew });
		}
		return breakdown;
	}

	function formatDateRange(): string {
		return formatImportDateRange(summary.dateRange);
	}

	let progressPercent = $derived(
		progressTotal > 0 ? Math.round((progressCurrent / progressTotal) * 100) : 0
	);

	async function handleImport() {
		commitState = { status: 'loading' };
		progressCurrent = 0;
		progressTotal = importableRows.length;

		const result = await commitImportRows(
			effectiveRows,
			assignments,
			(current, total) => {
				progressCurrent = current;
				progressTotal = total;
			},
			externalSkippedCount
		);

		if (result.error) {
			commitState = { status: 'error', error: result.error };
		} else {
			commitState = { status: 'success', data: result.data };
			onImportComplete(result.data);
			// Refresh vehicles context after successful commit (new vehicles may have been created)
			await vehiclesContext.refreshVehicles();
		}
	}

	function handleViewHistory() {
		// If a single vehicle was imported, switch to that vehicle
		if (commitState.status === 'success') {
			const result = commitState.data;
			const totalVehicles = result.vehiclesCreated.length + result.vehiclesMatched.length;
			if (totalVehicles === 1 && assignments.length === 1) {
				const assignment = assignments[0];
				if (assignment.existingVehicleId != null) {
					vehiclesContext.switchVehicle(assignment.existingVehicleId);
				} else if (assignment.assignmentType === 'new') {
					// After refreshVehicles(), look up the newly created vehicle by name
					const newVehicleName = assignment.newVehicle?.name ?? assignment.sourceVehicleName;
					const newVehicle = vehiclesContext.vehicles.find((v) => v.name === newVehicleName);
					if (newVehicle) {
						vehiclesContext.switchVehicle(newVehicle.id);
					}
				}
			}
		}
		void goto(resolve('/history'));
	}

	function handleViewAnalytics() {
		// Story 4.4: the analytics surface moved to /understand (the /analytics precursor redirects there).
		void goto(resolve('/understand'));
	}
</script>

<div class="space-y-4">
	{#if duplicateState === 'pending'}
		<!-- Story 8.3 AC1 (H7) — surfaced before the final commit trigger, aggregate keep/skip choice -->
		<div class="rounded-lg border border-amber-500/30 bg-amber-50 p-4 dark:bg-amber-950/20">
			<p class="text-sm font-semibold text-foreground">{m.import_duplicate_check_title()}</p>
			<p class="mt-1 text-sm text-muted-foreground">
				{m.import_duplicate_check_body({ count: duplicateRowNumbers.size })}
			</p>
			<div class="mt-3 flex gap-3">
				<button
					type="button"
					class="min-h-11 flex-1 rounded-xl border border-border bg-card px-4 py-2 text-sm font-semibold text-foreground"
					data-testid="duplicate-keep-btn"
					onclick={() => (duplicateState = 'keep')}
				>
					{m.import_duplicate_check_keep()}
				</button>
				<button
					type="button"
					class="min-h-11 flex-1 rounded-xl bg-accent px-4 py-2 text-sm font-semibold text-accent-foreground"
					data-testid="duplicate-skip-btn"
					onclick={() => (duplicateState = 'skip')}
				>
					{m.import_duplicate_check_skip()}
				</button>
			</div>
		</div>
	{:else if commitState.status === 'idle' || commitState.status === 'loading'}
		<!-- Pre-commit / committing view -->
		<div class="rounded-lg border border-border p-4 space-y-2">
			<div class="flex items-center gap-2">
				<span class="inline-block h-2.5 w-2.5 rounded-full bg-green-500"></span>
				<span class="text-sm text-foreground">
					{m.import_confirm_will_import({ count: importableRows.length })}
				</span>
			</div>

			{#if skippedRows.length + externalSkippedCount > 0}
				<div class="flex items-center gap-2">
					<span class="inline-block h-2.5 w-2.5 rounded-full bg-muted-foreground"></span>
					<span class="text-sm text-muted-foreground">
						{m.import_confirm_skipped({ count: skippedRows.length + externalSkippedCount })}
					</span>
					<button
						type="button"
						class="text-xs text-muted-foreground underline"
						aria-expanded={showSkipped}
						onclick={() => (showSkipped = !showSkipped)}
					>
						{showSkipped ? m.import_confirm_hide() : m.import_confirm_show_skipped()}
					</button>
				</div>
				{#if showSkipped}
					<ul class="ml-5 space-y-1 text-xs text-muted-foreground">
						{#each skippedRows as row (row.rowNumber)}
							<li>
								{m.import_confirm_skipped_row({
									row: row.rowNumber,
									issues: row.issues.join(', ')
								})}
							</li>
						{/each}
					</ul>
				{/if}
			{/if}

			{#if correctedCount > 0}
				<div class="flex items-center gap-2">
					<span class="inline-block h-2.5 w-2.5 rounded-full bg-blue-500"></span>
					<span class="text-sm text-foreground">
						{m.import_confirm_corrected({ count: correctedCount })}
					</span>
				</div>
			{/if}

			{#if newVehicleAssignments.length > 0}
				<div class="flex items-center gap-2">
					<span class="inline-block h-2.5 w-2.5 rounded-full bg-accent"></span>
					<span class="text-sm text-foreground">
						{m.import_confirm_new_vehicles({ count: newVehicleAssignments.length })}
					</span>
				</div>
			{/if}

			<div class="border-t border-border pt-2 mt-2 space-y-1">
				{#each getVehicleBreakdown() as entry (entry.name)}
					<p class="text-sm text-foreground">
						{entry.isNew
							? m.import_confirm_breakdown_new({ count: entry.count, name: entry.name })
							: m.import_confirm_breakdown({ count: entry.count, name: entry.name })}
					</p>
				{/each}
			</div>

			{#if summary.dateRange}
				<p class="text-xs text-muted-foreground">
					{m.import_confirm_data_spans({ range: formatDateRange() })}
				</p>
			{/if}
		</div>

		<!-- Caution notice -->
		<div class="rounded-lg border border-amber-500/30 bg-amber-50 p-3 dark:bg-amber-950/20">
			<p class="text-sm text-foreground">
				{m.import_confirm_caution()}
			</p>
		</div>

		<!-- Progress bar (during commit) -->
		{#if commitState.status === 'loading'}
			<div aria-live="polite" data-testid="import-progress">
				<p class="text-sm text-foreground mb-2">
					{m.import_confirm_progress({ current: progressCurrent, total: progressTotal })}
				</p>
				<div
					class="h-2 w-full rounded-full bg-muted"
					role="progressbar"
					aria-valuenow={progressCurrent}
					aria-valuemin={0}
					aria-valuemax={progressTotal}
					aria-label={m.import_confirm_progress_label()}
				>
					<div
						class="h-2 rounded-full bg-accent transition-all"
						style="width: {progressPercent}%"
					></div>
				</div>
			</div>
		{/if}

		<!-- Import button -->
		<button
			type="button"
			disabled={commitState.status === 'loading' || duplicateState === 'checking'}
			aria-busy={commitState.status === 'loading' ? 'true' : undefined}
			aria-disabled={commitState.status === 'loading' || duplicateState === 'checking'
				? 'true'
				: undefined}
			class="inline-flex min-h-11 w-full items-center justify-center rounded-xl bg-accent px-5 py-3 text-sm font-semibold text-accent-foreground disabled:cursor-not-allowed disabled:opacity-70"
			data-testid="import-btn"
			onclick={handleImport}
		>
			{commitState.status === 'loading'
				? m.import_confirm_importing()
				: m.import_confirm_import_button({ count: importableRows.length })}
		</button>
	{:else if commitState.status === 'error'}
		<!-- Error state -->
		<div class="rounded-lg border border-destructive bg-destructive/5 p-4" role="alert">
			<p class="text-sm font-semibold text-destructive">{m.import_confirm_failed_title()}</p>
			<p class="mt-1 text-sm text-muted-foreground">
				{commitState.error.message}
			</p>
			<p class="mt-1 text-xs text-muted-foreground">{m.import_confirm_failed_unchanged()}</p>
		</div>
		<button
			type="button"
			class="inline-flex min-h-11 w-full items-center justify-center rounded-xl bg-accent px-5 py-3 text-sm font-semibold text-accent-foreground"
			data-testid="retry-btn"
			onclick={handleImport}
		>
			{m.import_confirm_try_again()}
		</button>
	{:else if commitState.status === 'success'}
		<!-- Success state -->
		<div aria-live="polite" data-testid="import-success">
			<div class="flex flex-col items-center gap-2 py-4">
				<div
					class="flex h-12 w-12 items-center justify-center rounded-full bg-green-100 text-green-600 dark:bg-green-900/30 dark:text-green-400"
				>
					<svg
						xmlns="http://www.w3.org/2000/svg"
						width="24"
						height="24"
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						stroke-width="2"
						stroke-linecap="round"
						stroke-linejoin="round"
						aria-hidden="true"
					>
						<path d="M20 6 9 17l-5-5" />
					</svg>
				</div>
				<p class="text-lg font-semibold text-foreground">{m.import_confirm_complete()}</p>
			</div>

			<div class="rounded-lg border border-border p-4 space-y-1">
				{#if commitState.data.fuelCount > 0}
					<p class="text-sm text-foreground">
						{m.import_confirm_fuel_imported({ count: commitState.data.fuelCount })}
					</p>
				{/if}
				{#if commitState.data.maintenanceCount > 0}
					<p class="text-sm text-foreground">
						{m.import_confirm_maintenance_imported({ count: commitState.data.maintenanceCount })}
					</p>
				{/if}
				{#if commitState.data.skippedCount > 0}
					<p class="text-sm text-muted-foreground">
						{m.import_confirm_rows_skipped({ count: commitState.data.skippedCount })}
					</p>
				{/if}
				{#if commitState.data.vehiclesCreated.length > 0}
					<p class="text-sm text-foreground">
						{m.import_confirm_vehicles_created({ count: commitState.data.vehiclesCreated.length })}
					</p>
				{/if}
			</div>

			<div class="mt-4 flex flex-col gap-3">
				<button
					type="button"
					class="h-12 w-full rounded-xl bg-accent text-sm font-semibold text-accent-foreground"
					onclick={handleViewHistory}
				>
					{m.import_confirm_view_history()}
				</button>
				<button
					type="button"
					class="h-12 w-full rounded-xl border border-border bg-card text-sm font-semibold text-foreground"
					onclick={handleViewAnalytics}
				>
					{m.import_confirm_view_trends()}
				</button>
				<button
					type="button"
					class="h-12 w-full rounded-xl border border-border bg-card text-sm font-semibold text-foreground"
					onclick={onImportReset}
				>
					{m.import_confirm_import_another()}
				</button>
			</div>
		</div>
	{/if}
</div>
