import { toLocalDateInputValue } from '$lib/utils/date';
import { compareHistoryEntriesNewestFirst, type HistoryEntry } from '$lib/utils/historyEntries';

const CSV_HEADERS = [
	'date',
	'odometer',
	'entry type',
	'quantity',
	'unit',
	'cost',
	'calculated consumption',
	'notes'
] as const;
const UTF8_BOM = '\uFEFF';
const DANGEROUS_FORMULA_PREFIX_PATTERN = /^[ \t\r\n]*[=+\-@\uFF1D\uFF0B\uFF0D\uFF20]/;
const DANGEROUS_CONTROL_PREFIX_PATTERN = /^[\t\r\n]/;
const EXCEL_SAFE_TEXT_PREFIX = '\t';
const DOWNLOAD_URL_CLEANUP_DELAY_MS = 30_000;

function formatOptionalNumber(value: number | undefined): string {
	return value === undefined ? '' : String(value);
}

function sanitizeFormulaText(value: string): string {
	return DANGEROUS_CONTROL_PREFIX_PATTERN.test(value) ||
		DANGEROUS_FORMULA_PREFIX_PATTERN.test(value)
		? `${EXCEL_SAFE_TEXT_PREFIX}${value}`
		: value;
}

function formatOptionalText(value: string | undefined): string {
	return sanitizeFormulaText(value ?? '');
}

function escapeCSVCell(value: string): string {
	if (!/[\t",\r\n]/.test(value)) {
		return value;
	}

	return `"${value.replaceAll('"', '""')}"`;
}

function mapHistoryEntryToCSVRow(entry: HistoryEntry): string[] {
	if (entry.kind === 'fuel') {
		return [
			toLocalDateInputValue(entry.entry.date),
			String(entry.entry.odometer),
			'fuel',
			String(entry.entry.quantity),
			entry.entry.unit,
			String(entry.entry.totalCost),
			String(entry.entry.calculatedConsumption),
			formatOptionalText(entry.entry.notes)
		];
	}

	return [
		toLocalDateInputValue(entry.entry.date),
		formatOptionalNumber(entry.entry.odometer),
		sanitizeFormulaText(entry.entry.type),
		'',
		'',
		String(entry.entry.cost),
		'',
		formatOptionalText(entry.entry.notes)
	];
}

export function buildCSVFilename(exportDate: Date = new Date()): string {
	return `passanger-export-${toLocalDateInputValue(exportDate)}.csv`;
}

export function buildHistoryExportCSV(entries: HistoryEntry[]): string {
	const rows = [
		[...CSV_HEADERS],
		...[...entries]
			.sort(compareHistoryEntriesNewestFirst)
			.map((entry) => mapHistoryEntryToCSVRow(entry))
	];

	return rows.map((row) => row.map((cell) => escapeCSVCell(cell)).join(',')).join('\r\n');
}

export function downloadCSV(content: string, filename: string): void {
	const blob = new Blob([UTF8_BOM, content], { type: 'text/csv;charset=utf-8' });
	const objectUrl = URL.createObjectURL(blob);
	const anchor = document.createElement('a');

	anchor.href = objectUrl;
	anchor.download = filename;
	anchor.rel = 'noopener';
	anchor.style.display = 'none';

	document.body.appendChild(anchor);
	anchor.click();

	// Keep the blob URL alive well past the synthetic click because regular browser
	// downloads do not expose a reliable completion callback.
	window.setTimeout(() => {
		anchor.remove();
		URL.revokeObjectURL(objectUrl);
	}, DOWNLOAD_URL_CLEANUP_DELAY_MS);
}
