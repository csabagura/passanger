<script lang="ts">
	import { resolve } from '$app/paths';
	import { goto } from '$app/navigation';
	import ImportStepSource from '$lib/components/ImportStepSource.svelte';
	import ImportStepUpload from '$lib/components/ImportStepUpload.svelte';
	import ImportStepMapping from '$lib/components/ImportStepMapping.svelte';
	import ImportStepReview from '$lib/components/ImportStepReview.svelte';
	import ImportStepVehicles from '$lib/components/ImportStepVehicles.svelte';
	import ImportStepConfirm from '$lib/components/ImportStepConfirm.svelte';
	import { createInitialWizardState } from '$lib/utils/importTypes';
	import type {
		ImportSource,
		ImportRow,
		ImportDryRunSummary,
		ImportCommitResult,
		VehicleAssignment,
		ReviewRowState
	} from '$lib/utils/importTypes';
	import {
		loadImportProgress,
		saveImportProgress,
		clearImportProgress
	} from '$lib/state/importProgress';
	import { m } from '$lib/paraglide/messages';

	const STEP_LABELS = [
		m.import_step_source(),
		m.import_step_upload(),
		m.import_step_preview(),
		m.import_step_review(),
		m.import_step_vehicles(),
		m.import_step_confirm()
	] as const;

	// Story 5.4 (FR-16): hydrate any persisted in-progress import so a tab-close / reload resumes at
	// the saved step instead of restarting at Step 1. `loadImportProgress` returns null for an absent,
	// corrupt, stale, or post-commit payload → a clean Step-1 start. `file` is always null on resume
	// (AC3); the step components read `rawCSV`/`parsedRows`, not `file`.
	const restored = loadImportProgress();

	let wizardState = $state(restored?.state ?? createInitialWizardState());
	let showCancelConfirm = $state(false);

	// After a resume `wizardState.file` is null, so the Cancel gate keys off MEANINGFUL PROGRESS
	// instead of a live File handle — a resumed import still warns before discarding (AC3).
	const hasProgress = $derived(wizardState.step > 1 || wizardState.rawCSV !== null);
	const isFirstStep = $derived(wizardState.step === 1);

	function handleSourceSelected(source: ImportSource) {
		wizardState.selectedSource = source;
		wizardState.step = 2;
	}

	function handleFileProcessed(data: {
		file: File;
		rawCSV: string;
		confirmedFormat: ImportSource;
		rowCount: number;
	}) {
		wizardState.file = data.file;
		wizardState.rawCSV = data.rawCSV;
		wizardState.confirmedFormat = data.confirmedFormat;
		wizardState.rowCount = data.rowCount;
		wizardState.step = 3;
	}

	function handleMappingConfirmed(data: { rows: ImportRow[]; summary: ImportDryRunSummary }) {
		wizardState.parsedRows = data.rows;
		wizardState.dryRunSummary = data.summary;
		wizardState.step = 4;
	}

	function handleReviewConfirmed(data: { rows: ImportRow[]; summary: ImportDryRunSummary }) {
		wizardState.parsedRows = data.rows;
		wizardState.dryRunSummary = data.summary;
		wizardState.step = 5;
	}

	function handleVehiclesAssigned(data: { assignments: VehicleAssignment[] }) {
		wizardState.vehicleAssignments = data.assignments;
		wizardState.step = 6;
	}

	function handleImportComplete(result: ImportCommitResult) {
		wizardState.commitResult = result;
		// Clear persisted progress AFTER the atomic commit resolved (this runs in the parent, outside
		// the Dexie transaction) so a committed import never resurrects on reload (5.4 AC4/AC5).
		clearImportProgress();
	}

	function handleImportReset() {
		wizardState = createInitialWizardState();
		step4AutoSkipped = false;
		cachedReviewEntries = null;
		// Starting a fresh import after success — drop the persisted progress too (5.4 AC5).
		clearImportProgress();
	}

	const isPostCommit = $derived(wizardState.commitResult !== null);

	// Track whether step 4 was auto-skipped (all rows valid). Seeded from the resumed payload (5.4)
	// so a resume at Step 5 + Back returns to the correct step (3 when auto-skipped, else 4).
	let step4AutoSkipped = $state(restored?.step4AutoSkipped ?? false);

	// Cache review state for preservation across back-navigation (AC 9). Seeded from the resumed
	// payload (5.4) so a resumed Review/Vehicles step keeps the user's corrections.
	let cachedReviewEntries = $state<[number, ReviewRowState][] | null>(
		restored?.reviewEntries ?? null
	);

	// Story 5.4: write the in-progress state through to localStorage on each meaningful change so a
	// tab-close / reload resumes here. Single $effect (can't forget a handler). Snapshots the $state
	// proxy first ($state.snapshot — proxies aren't structured-clone-safe). Best-effort: the persist
	// swallows quota errors. Does NOTHING worth-saving at a pristine Step 1, and skips once committed
	// (terminal — already cleared in handleImportComplete; avoids re-writing a post-commit payload
	// after the clear, since this $effect flushes after that handler). Writes localStorage only — no
	// goto/replaceState/pushState here (would risk the hydration-flush crash class; this is safe).
	$effect(() => {
		if (wizardState.commitResult !== null) return;
		if (wizardState.step === 1 && wizardState.rawCSV === null) return;
		saveImportProgress($state.snapshot(wizardState), {
			step4AutoSkipped,
			reviewEntries: cachedReviewEntries
		});
	});

	function handleBack() {
		if (wizardState.step === 6 && isPostCommit) {
			// Cannot go back after commit
			return;
		}
		if (wizardState.step === 5 && step4AutoSkipped) {
			// If step 4 was auto-skipped, go back to step 3
			wizardState.step = 3;
			step4AutoSkipped = false;
		} else if (wizardState.step > 1) {
			wizardState.step = (wizardState.step - 1) as typeof wizardState.step;
		}
	}

	function handleCancel() {
		if (hasProgress) {
			openCancelDialog();
		} else {
			void goto(resolve('/export'));
		}
	}

	function confirmCancel() {
		closeCancelDialog();
		// Discard the persisted progress on an explicit cancel (5.4 AC5).
		clearImportProgress();
		void goto(resolve('/export'));
	}

	function dismissCancel() {
		closeCancelDialog();
	}

	let dialogRef: HTMLDivElement | undefined = $state();
	let previousFocus: HTMLElement | null = null;

	function trapFocus(event: KeyboardEvent) {
		if (event.key === 'Escape') {
			dismissCancel();
			return;
		}
		if (event.key !== 'Tab' || !dialogRef) return;
		const focusable = dialogRef.querySelectorAll<HTMLElement>(
			'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
		);
		if (focusable.length === 0) return;
		const first = focusable[0];
		const last = focusable[focusable.length - 1];
		if (event.shiftKey && document.activeElement === first) {
			event.preventDefault();
			last.focus();
		} else if (!event.shiftKey && document.activeElement === last) {
			event.preventDefault();
			first.focus();
		}
	}

	function openCancelDialog() {
		previousFocus = document.activeElement as HTMLElement | null;
		showCancelConfirm = true;
	}

	function closeCancelDialog() {
		showCancelConfirm = false;
		previousFocus?.focus();
		previousFocus = null;
	}

	// Move focus into the dialog when it opens
	$effect(() => {
		if (showCancelConfirm && dialogRef) {
			const firstFocusable = dialogRef.querySelector<HTMLElement>(
				'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
			);
			firstFocusable?.focus();
		}
	});
</script>

<div class="space-y-6">
	<!-- Progress indicator -->
	<nav aria-label={m.import_wizard_progress_label()}>
		<ol class="flex gap-1">
			{#each STEP_LABELS as label, i (label)}
				{@const stepNumber = i + 1}
				{@const isCurrent = stepNumber === wizardState.step}
				{@const isCompleted = stepNumber < wizardState.step}
				<li
					class="flex flex-1 flex-col items-center gap-1"
					aria-current={isCurrent ? 'step' : undefined}
				>
					<div
						class="h-1.5 w-full rounded-full transition-colors {isCurrent
							? 'bg-accent'
							: isCompleted
								? 'bg-accent/60'
								: 'bg-muted'}"
					></div>
					<span
						class="text-xs {isCurrent ? 'font-semibold text-foreground' : 'text-muted-foreground'}"
					>
						{label}
					</span>
				</li>
			{/each}
		</ol>
	</nav>

	<!-- Step heading -->
	<h2 class="text-lg font-semibold text-foreground">
		{m.import_wizard_step_heading({
			step: wizardState.step,
			label: STEP_LABELS[wizardState.step - 1]
		})}
	</h2>

	<!-- Step content -->
	{#if wizardState.step === 1}
		<ImportStepSource onSourceSelected={handleSourceSelected} />
	{:else if wizardState.step === 2 && wizardState.selectedSource}
		<ImportStepUpload
			selectedSource={wizardState.selectedSource}
			onFileProcessed={handleFileProcessed}
		/>
	{:else if wizardState.step === 3 && wizardState.rawCSV && wizardState.confirmedFormat && wizardState.confirmedFormat !== 'generic'}
		<ImportStepMapping
			rawCSV={wizardState.rawCSV}
			confirmedFormat={wizardState.confirmedFormat}
			onMappingConfirmed={handleMappingConfirmed}
		/>
	{:else if wizardState.step === 4 && wizardState.parsedRows.length > 0 && wizardState.dryRunSummary}
		<ImportStepReview
			rows={wizardState.parsedRows}
			summary={wizardState.dryRunSummary}
			initialReviewEntries={cachedReviewEntries ?? undefined}
			onReviewStateChanged={(entries) => {
				cachedReviewEntries = entries;
			}}
			onReviewConfirmed={(data) => {
				// Detect auto-skip: if called synchronously (no flagged rows), track it
				const hasFlagged = wizardState.parsedRows.some(
					(r) => r.status === 'warning' || r.status === 'error'
				);
				step4AutoSkipped = !hasFlagged;
				handleReviewConfirmed(data);
			}}
		/>
	{:else if wizardState.step === 5 && wizardState.parsedRows.length > 0 && wizardState.dryRunSummary}
		<ImportStepVehicles rows={wizardState.parsedRows} onVehiclesAssigned={handleVehiclesAssigned} />
	{:else if wizardState.step === 6 && wizardState.parsedRows.length > 0 && wizardState.dryRunSummary && wizardState.vehicleAssignments.length > 0}
		<ImportStepConfirm
			rows={wizardState.parsedRows}
			summary={wizardState.dryRunSummary}
			assignments={wizardState.vehicleAssignments}
			onImportComplete={handleImportComplete}
			onImportReset={handleImportReset}
		/>
	{:else}
		<!-- Honest fallback: the uploaded file's format wasn't recognized. We don't build a generic
		     parser (parsers are frozen) — we name the supported sources and offer a fresh start. -->
		<div
			class="space-y-4 rounded-2xl border border-border bg-card px-5 py-6"
			data-testid="unsupported-format"
		>
			<div>
				<p class="text-base font-semibold text-foreground">
					{m.import_unsupported_title()}
				</p>
				<!-- Brand names (Fuelly, aCar / Fuelio, Drivvo) are interpolated as params so they are
				     never translated; only the surrounding prose is. -->
				<p class="mt-1 text-sm text-muted-foreground">
					{m.import_unsupported_body({ fuelly: 'Fuelly', acar: 'aCar / Fuelio', drivvo: 'Drivvo' })}
				</p>
				<p class="mt-2 text-sm text-muted-foreground">
					{m.import_unsupported_retry()}
				</p>
			</div>
			<button
				type="button"
				class="inline-flex min-h-11 items-center justify-center rounded-xl bg-accent px-5 py-3 text-sm font-semibold text-accent-foreground"
				onclick={() => (wizardState.step = 1)}
			>
				{m.import_unsupported_choose_different()}
			</button>
		</div>
	{/if}

	<!-- Navigation buttons (hidden after commit) -->
	{#if !isPostCommit}
		<div class="flex items-center justify-between">
			<button
				type="button"
				disabled={isFirstStep}
				class="inline-flex min-h-11 items-center justify-center rounded-xl border border-border bg-card px-5 py-3 text-sm font-semibold text-foreground disabled:cursor-not-allowed disabled:opacity-70"
				onclick={handleBack}
			>
				{m.import_wizard_back()}
			</button>
			<button
				type="button"
				class="inline-flex min-h-11 items-center justify-center rounded-xl border border-border bg-card px-5 py-3 text-sm font-semibold text-foreground"
				onclick={handleCancel}
			>
				{m.common_cancel()}
			</button>
		</div>
	{/if}
</div>

<!-- Cancel confirmation dialog -->
{#if showCancelConfirm}
	<div
		class="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
		role="dialog"
		aria-modal="true"
		aria-label={m.import_cancel_dialog_label()}
		onkeydown={trapFocus}
	>
		<div bind:this={dialogRef} class="mx-4 w-full max-w-sm rounded-2xl bg-card p-6 shadow-lg">
			<h3 class="text-base font-semibold text-foreground">{m.import_cancel_dialog_heading()}</h3>
			<p class="mt-2 text-sm text-muted-foreground">
				{m.import_cancel_dialog_body()}
			</p>
			<div class="mt-4 flex gap-3">
				<button
					type="button"
					class="min-h-11 flex-1 rounded-xl border border-border bg-card px-4 py-2 text-sm font-semibold text-foreground"
					onclick={dismissCancel}
				>
					{m.import_cancel_dialog_keep()}
				</button>
				<button
					type="button"
					class="min-h-11 flex-1 rounded-xl bg-destructive px-4 py-2 text-sm font-semibold text-destructive-foreground"
					onclick={confirmCancel}
				>
					{m.import_cancel_dialog_confirm()}
				</button>
			</div>
		</div>
	</div>
{/if}
