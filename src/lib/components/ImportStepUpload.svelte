<script lang="ts">
	import {
		IMPORT_FILE_SIZE_WARN_BYTES,
		IMPORT_FILE_SIZE_MAX_BYTES,
		MAX_CSV_ROWS
	} from '$lib/config';
	import { detectCSVFormat } from '$lib/utils/importDetect';
	import type { ImportSource } from '$lib/utils/importTypes';
	import type { AppError } from '$lib/utils/result';

	type FileProcessingState =
		| { status: 'idle' }
		| { status: 'loading' }
		| { status: 'success'; fileName: string; fileSize: number; rowCount: number }
		| { status: 'error'; error: AppError };

	interface ImportStepUploadProps {
		selectedSource: ImportSource;
		onFileProcessed: (data: {
			file: File;
			rawCSV: string;
			confirmedFormat: ImportSource;
			rowCount: number;
		}) => void;
	}

	let { selectedSource, onFileProcessed }: ImportStepUploadProps = $props();

	let processingState = $state<FileProcessingState>({ status: 'idle' });
	let detectedFormat = $state<ImportSource | null>(null);
	let sizeWarning = $state('');
	let showConflict = $state(false);
	let fileRef = $state<File | null>(null);
	let rawCSVRef = $state<string | null>(null);
	let rowCountRef = $state(0);
	let fileInputEl: HTMLInputElement | undefined = $state();

	const formatLabels: Record<ImportSource, string> = {
		fuelly: 'Fuelly',
		acar: 'aCar / Fuelio',
		drivvo: 'Drivvo',
		generic: 'Generic CSV'
	};

	const canContinue = $derived(processingState.status === 'success' && !showConflict);

	function resetState() {
		processingState = { status: 'idle' };
		detectedFormat = null;
		sizeWarning = '';
		showConflict = false;
		fileRef = null;
		rawCSVRef = null;
		rowCountRef = 0;
	}

	async function processFile(file: File): Promise<void> {
		resetState();
		fileRef = file;
		processingState = { status: 'loading' };

		// Size rejection (>=10MB)
		if (file.size >= IMPORT_FILE_SIZE_MAX_BYTES) {
			processingState = {
				status: 'error',
				error: {
					code: 'FILE_TOO_LARGE',
					message: 'File too large. Try exporting a smaller date range.'
				}
			};
			return;
		}

		// Empty file check (0 bytes)
		if (file.size === 0) {
			processingState = {
				status: 'error',
				error: {
					code: 'EMPTY_FILE',
					message: 'This file appears to be empty. Check that you exported your data correctly.'
				}
			};
			return;
		}

		// Size warning (>5MB)
		if (file.size > IMPORT_FILE_SIZE_WARN_BYTES) {
			sizeWarning = 'This is a large file. Processing may take a moment.';
		}

		try {
			const rawCSV = await file.text();

			// Empty content check
			if (rawCSV.trim().length === 0) {
				processingState = {
					status: 'error',
					error: {
						code: 'EMPTY_FILE',
						message: 'This file appears to be empty. Check that you exported your data correctly.'
					}
				};
				return;
			}

			rawCSVRef = rawCSV;

			// Dynamic import PapaParse
			const Papa = await import('papaparse');
			const parseResult = Papa.parse(rawCSV, {
				header: false,
				skipEmptyLines: true,
				dynamicTyping: false
			});

			const rowCount = Math.max(0, parseResult.data.length - 1); // minus header row

			// Row limit check
			if (rowCount > MAX_CSV_ROWS) {
				processingState = {
					status: 'error',
					error: {
						code: 'TOO_MANY_ROWS',
						message: `This file has more than ${MAX_CSV_ROWS.toLocaleString()} rows. Import the most recent data first, then import older records in a second pass.`
					}
				};
				return;
			}

			// Empty after parse
			if (rowCount === 0) {
				processingState = {
					status: 'error',
					error: {
						code: 'EMPTY_FILE',
						message: 'This file appears to be empty. Check that you exported your data correctly.'
					}
				};
				return;
			}

			rowCountRef = rowCount;

			// Format detection
			const formatResult = detectCSVFormat(rawCSV);
			// Defensive: detectCSVFormat always returns ok() today, but Result<T>
			// contract allows errors — keep this guard for forward-compatibility
			if (formatResult.error) {
				processingState = {
					status: 'error',
					error: formatResult.error
				};
				return;
			}

			detectedFormat = formatResult.data;

			// Check for conflict with user's Step 1 selection
			if (detectedFormat !== selectedSource && detectedFormat !== 'generic') {
				showConflict = true;
			}

			processingState = {
				status: 'success',
				fileName: file.name,
				fileSize: file.size,
				rowCount
			};
		} catch {
			processingState = {
				status: 'error',
				error: {
					code: 'PARSE_ERROR',
					message: 'Could not read this file. Make sure it is a valid CSV or text file.'
				}
			};
		}
	}

	function handleFileInput(event: Event) {
		const input = event.target as HTMLInputElement;
		const file = input.files?.[0];
		if (file) {
			void processFile(file);
		}
	}

	function handleDrop(event: DragEvent) {
		event.preventDefault();
		const file = event.dataTransfer?.files[0];
		if (file) {
			void processFile(file);
		}
	}

	function handleDragOver(event: DragEvent) {
		event.preventDefault();
	}

	function resolveConflict(chosenFormat: ImportSource) {
		showConflict = false;
		detectedFormat = chosenFormat;
	}

	function handleContinue() {
		if (!canContinue || !fileRef || !rawCSVRef) return;
		// When detection returns 'generic' (unknown), trust the user's explicit Step 1 selection
		const confirmedFormat =
			detectedFormat && detectedFormat !== 'generic' ? detectedFormat : selectedSource;
		onFileProcessed({
			file: fileRef,
			rawCSV: rawCSVRef,
			confirmedFormat,
			rowCount: rowCountRef
		});
	}

	function formatFileSize(bytes: number): string {
		if (bytes < 1024) return `${bytes} B`;
		if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
		return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
	}
</script>

<div class="space-y-4">
	<!-- File input area -->
	{#if processingState.status === 'idle' || processingState.status === 'error'}
		<div
			class="flex flex-col items-center rounded-2xl border-2 border-dashed border-border bg-card p-6 text-center"
			role="region"
			aria-label="File upload area"
			ondrop={handleDrop}
			ondragover={handleDragOver}
		>
			<p class="text-sm text-muted-foreground">
				<span class="hidden md:inline">Drag and drop your CSV file here, or </span>
				<span class="md:hidden">Choose your CSV file to begin.</span>
			</p>
			<label
				class="mt-3 inline-flex min-h-12 cursor-pointer items-center justify-center rounded-xl bg-accent px-5 py-3 text-sm font-semibold text-accent-foreground"
			>
				Choose File
				<input
					bind:this={fileInputEl}
					type="file"
					accept=".csv,.txt"
					class="sr-only"
					onchange={handleFileInput}
				/>
			</label>
		</div>
	{/if}

	<!-- Loading state -->
	{#if processingState.status === 'loading'}
		<div
			class="flex items-center justify-center gap-3 rounded-2xl border border-border bg-card p-6"
			role="status"
		>
			<div
				class="h-5 w-5 animate-spin rounded-full border-2 border-accent border-t-transparent"
			></div>
			<p class="text-sm text-muted-foreground">Analyzing your file...</p>
		</div>
	{/if}

	<!-- Error state -->
	{#if processingState.status === 'error'}
		<div role="alert" class="rounded-2xl border border-destructive/20 bg-destructive/10 p-4">
			<p class="text-sm text-destructive">{processingState.error.message}</p>
		</div>
	{/if}

	<!-- Size warning -->
	{#if sizeWarning}
		<div class="rounded-2xl border border-amber-500/20 bg-amber-500/10 p-4">
			<p class="text-sm text-amber-700 dark:text-amber-400">{sizeWarning}</p>
		</div>
	{/if}

	<!-- Success state: file info + format badge -->
	{#if processingState.status === 'success'}
		<div class="space-y-3 rounded-2xl border border-border bg-card p-5 shadow-sm">
			<div class="flex items-center justify-between">
				<div>
					<p class="text-sm font-semibold text-foreground">{processingState.fileName}</p>
					<p class="text-sm text-muted-foreground">
						{formatFileSize(processingState.fileSize)} · Found {processingState.rowCount} rows
					</p>
				</div>
				<button
					type="button"
					class="text-sm text-muted-foreground underline"
					onclick={() => {
						resetState();
						if (fileInputEl) fileInputEl.value = '';
					}}
				>
					Change
				</button>
			</div>

			<!-- Format badge -->
			{#if detectedFormat}
				{@const isMatch = detectedFormat === selectedSource || detectedFormat === 'generic'}
				<div class="flex items-center gap-2">
					<span
						class="inline-flex items-center rounded-full px-3 py-1 text-xs font-medium {isMatch
							? 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400'
							: 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400'}"
					>
						Detected: {formatLabels[detectedFormat]}
					</span>
				</div>
			{/if}
		</div>

		<!-- Conflict resolution -->
		{#if showConflict && detectedFormat}
			<div
				class="space-y-3 rounded-2xl border border-amber-500/20 bg-amber-500/10 p-4"
				role="alert"
			>
				<p class="text-sm text-foreground">
					We detected <strong>{formatLabels[detectedFormat]}</strong> format, but you selected
					<strong>{formatLabels[selectedSource]}</strong>. Which is correct?
				</p>
				<div class="flex gap-3">
					<button
						type="button"
						class="min-h-11 flex-1 rounded-xl border border-border bg-card px-4 py-2 text-sm font-semibold text-foreground"
						onclick={() => resolveConflict(detectedFormat!)}
					>
						Use {formatLabels[detectedFormat]}
					</button>
					<button
						type="button"
						class="min-h-11 flex-1 rounded-xl border border-border bg-card px-4 py-2 text-sm font-semibold text-foreground"
						onclick={() => resolveConflict(selectedSource)}
					>
						Use {formatLabels[selectedSource]}
					</button>
				</div>
			</div>
		{/if}

		<!-- Continue button -->
		<button
			type="button"
			disabled={!canContinue}
			class="inline-flex min-h-11 items-center justify-center rounded-xl bg-accent px-5 py-3 text-sm font-semibold text-accent-foreground disabled:cursor-not-allowed disabled:opacity-70"
			onclick={handleContinue}
		>
			Continue
		</button>
	{/if}
</div>
