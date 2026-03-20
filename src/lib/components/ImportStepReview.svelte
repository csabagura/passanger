<script lang="ts">
	import { tick } from 'svelte';
	import { SvelteMap } from 'svelte/reactivity';
	import type {
		ImportRow,
		ImportDryRunSummary,
		NormalizedImportEntry,
		ReviewRowState
	} from '$lib/utils/importTypes';
	import { validateImportRow } from '$lib/utils/importValidation';
	import { buildDryRunSummary } from '$lib/utils/importValidation';

	const FIELD_ISSUE_MAP: Record<string, string[]> = {
		date: ['Missing date', 'Date could not be read', 'Date is in the future'],
		odometer: [
			'Missing odometer reading',
			'Negative value \u2014 check the sign',
			'Odometer is lower than the previous entry'
		],
		quantity: [
			'Missing fuel quantity',
			'Fuel quantity is zero',
			'Negative value \u2014 check the sign'
		],
		totalCost: [
			'Missing cost',
			'Cost is zero \u2014 is this correct?',
			'Negative value \u2014 check the sign'
		]
	};

	interface ImportStepReviewProps {
		rows: ImportRow[];
		summary: ImportDryRunSummary;
		onReviewConfirmed: (data: { rows: ImportRow[]; summary: ImportDryRunSummary }) => void;
		initialReviewEntries?: [number, ReviewRowState][];
		onReviewStateChanged?: (entries: [number, ReviewRowState][]) => void;
	}

	let {
		rows,
		summary,
		onReviewConfirmed,
		initialReviewEntries,
		onReviewStateChanged
	}: ImportStepReviewProps = $props();

	let reviewState = new SvelteMap<number, ReviewRowState>();
	let expandedRowNumber = $state<number | null>(null);

	// Track per-field edit values for the currently expanded card
	let editValues = $state<Record<string, string>>({});
	// Track per-field errors for the currently expanded card
	let fieldErrors = $state<Record<string, string>>({});

	const flaggedRows = $derived(
		rows.filter((r) => r.status === 'warning' || r.status === 'error')
	);

	const reviewedCount = $derived.by(() => {
		let count = 0;
		for (const [, state] of reviewState) {
			if (state.status === 'corrected' || state.status === 'skipped') {
				count++;
			}
		}
		return count;
	});

	const allReviewed = $derived(reviewedCount === flaggedRows.length);

	const updatedCounts = $derived.by(() => {
		let validCount = 0;
		let warningCount = 0;
		let errorCount = 0;
		let skippedCount = 0;

		for (const row of rows) {
			const state = reviewState.get(row.rowNumber);
			if (state?.status === 'skipped') {
				skippedCount++;
			} else if (state?.status === 'corrected') {
				if (state.correctedStatus === 'valid') validCount++;
				else if (state.correctedStatus === 'warning') warningCount++;
				else errorCount++;
			} else {
				if (row.status === 'valid') validCount++;
				else if (row.status === 'warning') warningCount++;
				else if (row.status === 'error') errorCount++;
			}
		}

		return { validCount, warningCount, errorCount, skippedCount };
	});

	// Auto-skip: if no flagged rows, call onReviewConfirmed immediately
	$effect(() => {
		if (flaggedRows.length === 0) {
			onReviewConfirmed({ rows, summary });
		}
	});

	// Initialize review state for all flagged rows (restore from cache if available)
	$effect(() => {
		if (flaggedRows.length > 0 && reviewState.size === 0) {
			const flaggedRowNumbers = new Set(flaggedRows.map((r) => r.rowNumber));

			if (initialReviewEntries && initialReviewEntries.length > 0) {
				// Restore cached entries for rows that still exist as flagged
				for (const [rowNumber, state] of initialReviewEntries) {
					if (flaggedRowNumbers.has(rowNumber)) {
						reviewState.set(rowNumber, { ...state });
					}
				}
			}

			// Initialize any flagged rows not in cached state
			for (const row of flaggedRows) {
				if (!reviewState.has(row.rowNumber)) {
					reviewState.set(row.rowNumber, {
						status: 'pending',
						correctedData: {},
						correctedIssues: [...row.issues],
						correctedStatus: row.status
					});
				}
			}
		}
	});

	function getRowState(rowNumber: number): ReviewRowState {
		return (
			reviewState.get(rowNumber) ?? {
				status: 'pending',
				correctedData: {},
				correctedIssues: [],
				correctedStatus: 'valid'
			}
		);
	}

	function notifyStateChanged() {
		onReviewStateChanged?.(Array.from(reviewState.entries()));
	}

	function getRowData(row: ImportRow): Partial<NormalizedImportEntry> {
		const state = getRowState(row.rowNumber);
		if (state.status === 'corrected') {
			return { ...row.data, ...state.correctedData };
		}
		return row.data;
	}

	function getRowIssues(row: ImportRow): string[] {
		const state = getRowState(row.rowNumber);
		if (state.status === 'corrected') {
			return state.correctedIssues;
		}
		return row.issues;
	}

	function formatDateForDisplay(date: Date | undefined): string {
		if (!date || !(date instanceof Date) || isNaN(date.getTime())) return '—';
		return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
	}

	function formatNumber(value: number | undefined, decimals = 1): string {
		if (value == null || isNaN(value)) return '—';
		return value.toLocaleString('en', {
			minimumFractionDigits: decimals,
			maximumFractionDigits: decimals
		});
	}

	function getDataSummary(row: ImportRow): string {
		const data = getRowData(row);
		const parts: string[] = [];
		parts.push(formatDateForDisplay(data.date));
		if (data.odometer != null && !isNaN(data.odometer)) {
			parts.push(`${formatNumber(data.odometer, 0)} km`);
		}
		if (data.type === 'fuel' && data.quantity != null && !isNaN(data.quantity)) {
			parts.push(`${formatNumber(data.quantity)} ${data.unit ?? 'L'}`);
		}
		if (data.totalCost != null && !isNaN(data.totalCost)) {
			parts.push(`${formatNumber(data.totalCost, 2)}`);
		}
		return parts.join(' \u2014 ');
	}

	function getIssueLabel(row: ImportRow): string {
		const issues = getRowIssues(row);
		if (issues.length === 0) return '';
		if (issues.length === 1) return issues[0];
		return `${issues.length} issues`;
	}

	function getSeverityBadge(row: ImportRow): { text: string; class: string } {
		if (row.status === 'error') {
			return { text: '[!]', class: 'text-destructive font-bold' };
		}
		return { text: '[\u26A0]', class: 'text-amber-600 dark:text-amber-400 font-bold' };
	}

	function getCardBorderClass(row: ImportRow): string {
		const state = getRowState(row.rowNumber);
		if (state.status === 'corrected') {
			return 'border-green-500 bg-green-50 dark:bg-green-950/20';
		}
		if (state.status === 'skipped') {
			return 'border-muted opacity-60';
		}
		if (row.status === 'error') {
			return 'border-destructive bg-destructive/5';
		}
		return 'border-amber-500 bg-amber-50 dark:bg-amber-950/20';
	}

	function isFieldInvalid(row: ImportRow, fieldName: string): boolean {
		const fieldIssues = FIELD_ISSUE_MAP[fieldName] ?? [];
		const SHARED_NEGATIVE_ISSUE = 'Negative value \u2014 check the sign';
		return row.issues.some((issue) => {
			if (!fieldIssues.includes(issue)) return false;
			// "Negative value" is shared across odometer/quantity/totalCost —
			// only mark the field whose value is actually negative
			if (issue === SHARED_NEGATIVE_ISSUE) {
				const data = getRowData(row);
				const value = data[fieldName as keyof typeof data] as number | undefined;
				return value != null && typeof value === 'number' && value < 0;
			}
			return true;
		});
	}

	function getFieldError(fieldName: string): string {
		return fieldErrors[fieldName] ?? '';
	}

	function parseDateInput(value: string): Date | null {
		const parts = value.trim().split('-');
		if (parts.length !== 3) return null;
		const year = parseInt(parts[0], 10);
		const month = parseInt(parts[1], 10);
		const day = parseInt(parts[2], 10);
		if (isNaN(year) || isNaN(month) || isNaN(day)) return null;
		if (month < 1 || month > 12 || day < 1 || day > 31) return null;
		const date = new Date(year, month - 1, day);
		if (date.getMonth() !== month - 1 || date.getDate() !== day) return null;
		return date;
	}

	type InputMode = 'text' | 'decimal' | 'numeric' | 'tel' | 'search' | 'email' | 'url' | 'none';

	function getEditableFields(row: ImportRow): { name: string; label: string; inputMode: InputMode }[] {
		const fields: { name: string; label: string; inputMode: InputMode }[] = [
			{ name: 'date', label: 'Date', inputMode: 'text' },
			{ name: 'odometer', label: 'Odometer', inputMode: 'decimal' },
			...(row.data.type !== 'maintenance'
				? [{ name: 'quantity', label: 'Quantity', inputMode: 'decimal' as InputMode }]
				: []),
			{ name: 'totalCost', label: 'Cost', inputMode: 'decimal' },
			{ name: 'notes', label: 'Notes', inputMode: 'text' }
		];
		return fields;
	}

	function getFieldDisplayValue(row: ImportRow, fieldName: string): string {
		const data = getRowData(row);
		switch (fieldName) {
			case 'date':
				return formatDateForDisplay(data.date);
			case 'odometer':
				return data.odometer != null ? formatNumber(data.odometer, 0) : '—';
			case 'quantity':
				return data.quantity != null ? `${formatNumber(data.quantity)} ${data.unit ?? 'L'}` : '—';
			case 'totalCost':
				return data.totalCost != null ? formatNumber(data.totalCost, 2) : '—';
			case 'notes':
				return data.notes ?? '';
			default:
				return '';
		}
	}

	function getFieldEditValue(row: ImportRow, fieldName: string): string {
		const data = getRowData(row);
		switch (fieldName) {
			case 'date':
				return formatDateForDisplay(data.date);
			case 'odometer':
				return data.odometer != null && !isNaN(data.odometer) ? String(data.odometer) : '';
			case 'quantity':
				return data.quantity != null && !isNaN(data.quantity) ? String(data.quantity) : '';
			case 'totalCost':
				return data.totalCost != null && !isNaN(data.totalCost) ? String(data.totalCost) : '';
			case 'notes':
				return data.notes ?? '';
			default:
				return '';
		}
	}

	function handleExpand(rowNumber: number) {
		if (expandedRowNumber === rowNumber) {
			expandedRowNumber = null;
			return;
		}
		expandedRowNumber = rowNumber;
		// Initialize edit values for the expanded row
		const row = flaggedRows.find((r) => r.rowNumber === rowNumber);
		if (row) {
			const fields = getEditableFields(row);
			const values: Record<string, string> = {};
			for (const field of fields) {
				if (isFieldInvalid(row, field.name)) {
					values[field.name] = getFieldEditValue(row, field.name);
				}
			}
			editValues = values;
			fieldErrors = {};

			// Focus first invalid input after DOM update
			tick().then(() => {
				const firstInput = document.querySelector(
					`#review-row-${rowNumber} input`
				) as HTMLElement | null;
				firstInput?.focus();
			});
		}
	}

	function applyFieldValue(
		data: Partial<NormalizedImportEntry>,
		fieldName: string,
		value: string
	): void {
		switch (fieldName) {
			case 'date': {
				const parsed = parseDateInput(value);
				if (parsed) data.date = parsed;
				else if (value.trim() === '') data.date = undefined;
				else data.date = new Date(NaN);
				break;
			}
			case 'odometer': {
				const num = parseFloat(value);
				data.odometer = isNaN(num) ? undefined : num;
				break;
			}
			case 'quantity': {
				const num = parseFloat(value);
				data.quantity = isNaN(num) ? undefined : num;
				break;
			}
			case 'totalCost': {
				const num = parseFloat(value);
				data.totalCost = isNaN(num) ? undefined : num;
				break;
			}
			case 'notes':
				data.notes = value;
				break;
		}
	}

	function handleFieldBlur(row: ImportRow, fieldName: string) {
		const value = editValues[fieldName] ?? '';
		const data = { ...getRowData(row) };

		applyFieldValue(data, fieldName, value);

		// Re-validate the full row
		const validated = validateImportRow(data, row.rowNumber, undefined, {
			skipQuantityValidation: data.type === 'maintenance'
		});

		// Update field error for this specific field
		const relevantIssues = FIELD_ISSUE_MAP[fieldName] ?? [];
		const fieldIssue = validated.issues.find((issue) => relevantIssues.includes(issue));
		const newErrors = { ...fieldErrors };
		if (fieldIssue) {
			newErrors[fieldName] = fieldIssue;
		} else {
			delete newErrors[fieldName];
		}
		fieldErrors = newErrors;
	}

	function handleSaveCorrections(row: ImportRow) {
		const data = { ...getRowData(row) };

		// Apply all current edit values
		for (const [fieldName, value] of Object.entries(editValues)) {
			applyFieldValue(data, fieldName, value);
		}

		// Re-validate full row
		const validated = validateImportRow(data, row.rowNumber, undefined, {
			skipQuantityValidation: data.type === 'maintenance'
		});

		// If there are still errors, show them and don't save
		if (validated.status === 'error') {
			// Update all field errors
			const newErrors: Record<string, string> = {};
			for (const [fieldName, issues] of Object.entries(FIELD_ISSUE_MAP)) {
				const fieldIssue = validated.issues.find((issue) => issues.includes(issue));
				if (fieldIssue) newErrors[fieldName] = fieldIssue;
			}
			fieldErrors = newErrors;
			return;
		}

		// Save corrections
		const corrections: Partial<NormalizedImportEntry> = {};
		for (const [fieldName, value] of Object.entries(editValues)) {
			applyFieldValue(corrections, fieldName, value);
		}

		reviewState.set(row.rowNumber, {
			status: 'corrected',
			correctedData: corrections,
			correctedIssues: validated.issues,
			correctedStatus: validated.status
		});
		expandedRowNumber = null;
		notifyStateChanged();

		// Focus next flagged card's Edit button
		focusNextCard(row.rowNumber);
	}

	function handleSkip(row: ImportRow) {
		const existing = getRowState(row.rowNumber);
		reviewState.set(row.rowNumber, {
			...existing,
			status: 'skipped'
		});
		expandedRowNumber = null;
		notifyStateChanged();

		// Focus next flagged card
		focusNextCard(row.rowNumber);
	}

	function handleUnskip(row: ImportRow) {
		const existing = getRowState(row.rowNumber);
		reviewState.set(row.rowNumber, {
			...existing,
			status: 'pending'
		});
		notifyStateChanged();
	}

	function handleSkipAllRemaining() {
		for (const row of flaggedRows) {
			const existing = getRowState(row.rowNumber);
			if (existing.status === 'pending') {
				reviewState.set(row.rowNumber, {
					...existing,
					status: 'skipped'
				});
			}
		}
		notifyStateChanged();
	}

	function focusNextCard(currentRowNumber: number) {
		const currentIndex = flaggedRows.findIndex((r) => r.rowNumber === currentRowNumber);
		const nextRow = flaggedRows[currentIndex + 1];
		tick().then(() => {
			if (nextRow) {
				const btn = document.querySelector(
					`[aria-controls="review-row-${nextRow.rowNumber}"]`
				) as HTMLElement | null;
				btn?.focus();
			} else {
				// Focus primary action button
				const primaryBtn = document.querySelector(
					'[data-testid="assign-vehicles-btn"]'
				) as HTMLElement | null;
				primaryBtn?.focus();
			}
		});
	}

	function buildFinalRows(): ImportRow[] {
		return rows.filter((row) => {
			const state = reviewState.get(row.rowNumber);
			if (state?.status === 'skipped') return false;
			return true;
		}).map((row) => {
			const state = reviewState.get(row.rowNumber);
			if (state?.status === 'corrected') {
				const mergedData = { ...row.data, ...state.correctedData };
				return {
					...row,
					data: mergedData,
					status: state.correctedStatus,
					issues: state.correctedIssues
				};
			}
			return row;
		});
	}

	function handleAssignVehicles() {
		if (!allReviewed) return;
		const finalRows = buildFinalRows();
		const finalSummary = buildDryRunSummary(finalRows);
		onReviewConfirmed({ rows: finalRows, summary: finalSummary });
	}
</script>

{#if flaggedRows.length > 0}
	<div class="space-y-4">
		<!-- Summary strip -->
		<div
			class="rounded-xl border border-border bg-muted/50 px-4 py-3"
			aria-live="polite"
			data-testid="review-summary"
		>
			<p class="text-sm text-foreground">
				{flaggedRows.length} row{flaggedRows.length !== 1 ? 's' : ''} need{flaggedRows.length === 1 ? 's' : ''} attention
				{#if reviewedCount > 0}
					&mdash; {reviewedCount} of {flaggedRows.length} reviewed
				{/if}
			</p>
			{#if reviewedCount > 0}
				<p class="mt-1 text-xs text-muted-foreground" data-testid="review-status-counts">
					{updatedCounts.validCount} valid, {updatedCounts.warningCount} warning, {updatedCounts.errorCount} error, {updatedCounts.skippedCount} skipped
				</p>
			{/if}
		</div>

		<!-- Row completion announcements -->
		<div aria-live="polite" class="sr-only" data-testid="review-announcements">
			{#if reviewedCount > 0}
				{reviewedCount} of {flaggedRows.length} rows reviewed
			{/if}
		</div>

		<!-- Flagged row cards -->
		{#each flaggedRows as row (row.rowNumber)}
			{@const state = getRowState(row.rowNumber)}
			{@const isExpanded = expandedRowNumber === row.rowNumber}
			{@const severity = getSeverityBadge(row)}
			{@const issueLabel = getIssueLabel(row)}

			<div
				class="rounded-lg border p-4 {getCardBorderClass(row)}"
				data-testid="review-card-{row.rowNumber}"
			>
				<!-- Collapsed card header -->
				<div class="flex items-start justify-between gap-2">
					<div class={state.status === 'skipped' ? 'line-through' : ''}>
						<p class="text-sm text-foreground">
							<span class={severity.class} aria-hidden="true">{severity.text}</span>
							<span class="font-medium">Row {row.rowNumber}</span>
							{#if state.status === 'corrected'}
								<span class="ml-2 inline-flex items-center rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-800 dark:bg-green-900/30 dark:text-green-400">Corrected</span>
							{:else if state.status === 'skipped'}
								<span class="ml-2 inline-flex items-center rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">Skipped</span>
							{/if}
						</p>
						<p class="mt-0.5 text-xs text-muted-foreground">
							{getDataSummary(row)}
						</p>
						{#if state.status === 'pending' && issueLabel}
							<p class="mt-0.5 text-xs text-muted-foreground">
								{issueLabel}
							</p>
						{/if}
					</div>
					<button
						type="button"
						class="inline-flex min-h-11 items-center justify-center rounded-lg border border-border bg-card px-3 py-2 text-sm font-semibold text-foreground"
						aria-expanded={isExpanded}
						aria-controls="review-row-{row.rowNumber}"
						aria-label={state.status === 'skipped'
							? `Undo skip for Row ${row.rowNumber}`
							: `Edit Row ${row.rowNumber}: ${getDataSummary(row)}, ${row.issues.length} ${row.status === 'error' ? 'error' : 'warning'}${row.issues.length !== 1 ? 's' : ''}`}
						onclick={() => handleExpand(row.rowNumber)}
					>
						{state.status === 'skipped' ? 'Undo' : 'Edit'}
					</button>
				</div>

				<!-- Expanded card content -->
				{#if isExpanded}
					<div
						id="review-row-{row.rowNumber}"
						class="mt-3 space-y-3 border-t border-border pt-3"
					>
						{#if state.status === 'skipped'}
							<!-- Un-skip option -->
							<div class="flex flex-col gap-2">
								<p class="text-sm text-muted-foreground">
									This row is currently skipped and will not be imported.
								</p>
								<button
									type="button"
									class="h-12 w-full rounded-md border border-border bg-card text-sm font-semibold text-foreground"
									onclick={() => handleUnskip(row)}
								>
									Include This Row
								</button>
							</div>
						{:else}
							<!-- Editable fields -->
							{#each getEditableFields(row) as field (field.name)}
								{@const invalid = isFieldInvalid(row, field.name)}
								{@const error = getFieldError(field.name)}
								<div>
									<label class="block text-xs font-medium text-muted-foreground" for="field-{row.rowNumber}-{field.name}">
										{field.label}
									</label>
									{#if invalid}
										<input
											id="field-{row.rowNumber}-{field.name}"
											type="text"
											inputmode={field.inputMode}
											class="mt-1 h-12 w-full rounded-md border px-3 text-sm text-foreground {error ? 'border-destructive' : 'border-border'}"
											value={editValues[field.name] ?? ''}
											oninput={(e) => {
												editValues[field.name] = (e.target as HTMLInputElement).value;
											}}
											onblur={() => handleFieldBlur(row, field.name)}
											aria-invalid={error ? 'true' : undefined}
											aria-describedby={error ? `error-${row.rowNumber}-${field.name}` : undefined}
										/>
										{#if error}
											<p
												id="error-{row.rowNumber}-{field.name}"
												class="mt-1 text-sm text-destructive"
												role="alert"
											>
												{error}
											</p>
										{/if}
									{:else}
										<span class="mt-1 block text-sm text-muted-foreground">
											{getFieldDisplayValue(row, field.name)}
											<span class="text-xs">(valid)</span>
										</span>
									{/if}
								</div>
							{/each}

							<!-- Action buttons -->
							<div class="flex flex-col gap-2 pt-2 sm:flex-row">
								<button
									type="button"
									class="h-12 w-full rounded-md bg-accent text-sm font-semibold text-accent-foreground sm:flex-1"
									onclick={() => handleSaveCorrections(row)}
								>
									Save Corrections
								</button>
								<button
									type="button"
									class="h-12 w-full rounded-md border border-border bg-card text-sm font-semibold text-foreground sm:flex-1"
									onclick={() => handleSkip(row)}
								>
									Skip This Row
								</button>
							</div>
						{/if}
					</div>
				{/if}
			</div>
		{/each}

		<!-- Skip all remaining -->
		{#if flaggedRows.some((r) => getRowState(r.rowNumber).status === 'pending')}
			<button
				type="button"
				class="text-xs text-muted-foreground underline"
				onclick={handleSkipAllRemaining}
			>
				Skip all remaining flagged rows
			</button>
		{/if}

		<!-- Primary action button -->
		<button
			type="button"
			disabled={!allReviewed}
			class="inline-flex min-h-11 w-full items-center justify-center rounded-xl bg-accent px-5 py-3 text-sm font-semibold text-accent-foreground disabled:cursor-not-allowed disabled:opacity-70"
			data-testid="assign-vehicles-btn"
			onclick={handleAssignVehicles}
		>
			Assign Vehicles
		</button>
	</div>
{/if}
