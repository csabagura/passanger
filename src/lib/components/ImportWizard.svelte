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

	const STEP_LABELS = ['Source', 'Upload', 'Mapping', 'Review', 'Vehicles', 'Confirm'] as const;

	let wizardState = $state(createInitialWizardState());
	let showCancelConfirm = $state(false);

	const hasFile = $derived(wizardState.file !== null);
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
	}

	function handleImportReset() {
		wizardState = createInitialWizardState();
		step4AutoSkipped = false;
		cachedReviewEntries = null;
	}

	const isPostCommit = $derived(wizardState.commitResult !== null);

	// Track whether step 4 was auto-skipped (all rows valid)
	let step4AutoSkipped = $state(false);

	// Cache review state for preservation across back-navigation (AC 9)
	let cachedReviewEntries = $state<[number, ReviewRowState][] | null>(null);

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
		if (hasFile) {
			openCancelDialog();
		} else {
			void goto(resolve('/export'));
		}
	}

	function confirmCancel() {
		closeCancelDialog();
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
	<nav aria-label="Import wizard progress">
		<ol class="flex gap-1">
			{#each STEP_LABELS as label, i}
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
		Step {wizardState.step} of 6: {STEP_LABELS[wizardState.step - 1]}
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
		<ImportStepVehicles
			rows={wizardState.parsedRows}
			onVehiclesAssigned={handleVehiclesAssigned}
		/>
	{:else if wizardState.step === 6 && wizardState.parsedRows.length > 0 && wizardState.dryRunSummary && wizardState.vehicleAssignments.length > 0}
		<ImportStepConfirm
			rows={wizardState.parsedRows}
			summary={wizardState.dryRunSummary}
			assignments={wizardState.vehicleAssignments}
			onImportComplete={handleImportComplete}
			onImportReset={handleImportReset}
		/>
	{:else}
		<!-- Step 3 generic format placeholder -->
		<div class="rounded-2xl border border-dashed border-border bg-card px-4 py-8 text-center">
			<p class="text-base font-semibold text-foreground">Coming soon</p>
			<p class="mt-1 text-sm text-muted-foreground">
				This step will be available in a future update.
			</p>
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
				Back
			</button>
			<button
				type="button"
				class="inline-flex min-h-11 items-center justify-center rounded-xl border border-border bg-card px-5 py-3 text-sm font-semibold text-foreground"
				onclick={handleCancel}
			>
				Cancel
			</button>
		</div>
	{/if}
</div>

<!-- Cancel confirmation dialog -->
{#if showCancelConfirm}
	<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
	<!-- svelte-ignore a11y_interactive_supports_focus -->
	<div
		class="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
		role="dialog"
		aria-modal="true"
		aria-label="Confirm cancel import"
		onkeydown={trapFocus}
	>
		<div bind:this={dialogRef} class="mx-4 w-full max-w-sm rounded-2xl bg-card p-6 shadow-lg">
			<h3 class="text-base font-semibold text-foreground">Cancel import?</h3>
			<p class="mt-2 text-sm text-muted-foreground">
				Your uploaded file and progress will be lost.
			</p>
			<div class="mt-4 flex gap-3">
				<button
					type="button"
					class="min-h-11 flex-1 rounded-xl border border-border bg-card px-4 py-2 text-sm font-semibold text-foreground"
					onclick={dismissCancel}
				>
					Keep working
				</button>
				<button
					type="button"
					class="min-h-11 flex-1 rounded-xl bg-destructive px-4 py-2 text-sm font-semibold text-destructive-foreground"
					onclick={confirmCancel}
				>
					Cancel import
				</button>
			</div>
		</div>
	</div>
{/if}
