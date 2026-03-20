// CSV format auto-detection for import wizard
// Examines first line(s) to identify source app

import { ok } from '$lib/utils/result';
import type { Result } from '$lib/utils/result';
import type { ImportSource } from '$lib/utils/importTypes';

export function detectCSVFormat(csvContent: string): Result<ImportSource> {
	const firstLine = csvContent.split('\n')[0]?.trim() ?? '';

	// aCar/Fuelio: starts with "## Vehicle"
	if (firstLine.startsWith('## Vehicle')) return ok('acar');

	// Drivvo: starts with "##Refuelling" or "#Reabastecimiento" (or other locale variants)
	if (/^#{1,2}(Refuelling|Reabastecimiento|Service|Servicio)/i.test(firstLine)) return ok('drivvo');

	// Fuelly: header row contains "fuelup_date" or "city_percentage"
	const headerLower = firstLine.toLowerCase();
	if (headerLower.includes('fuelup_date') || headerLower.includes('city_percentage'))
		return ok('fuelly');

	// Unknown — fall back to generic (not an error)
	return ok('generic');
}
