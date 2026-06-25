// Shared presentation helpers for the import wizard preview.
// Kept tiny and pure so the value-first Preview step and the Confirm step format the
// imported date span identically (and so the format is unit-testable).

import type { ImportDryRunSummary } from '$lib/utils/importTypes';

/**
 * Format a dry-run date range as "Mon YYYY – Mon YYYY" (e.g. "Jun 2021 – Sep 2021").
 * Returns '' when there is no valid range, so callers can degrade to a count-only headline.
 */
export function formatImportDateRange(dateRange: ImportDryRunSummary['dateRange']): string {
	if (!dateRange) return '';
	// Explicit 'en' locale (mirrors this subsystem's other date formatting, e.g. ImportStepMapping's
	// formatDate) so the span is deterministic and the Preview/Confirm steps render it identically.
	const fmt = (d: Date) => d.toLocaleDateString('en', { month: 'short', year: 'numeric' });
	return `${fmt(dateRange.start)} – ${fmt(dateRange.end)}`;
}
