// CSV section splitter for aCar/Fuelio and Drivvo sectioned CSV formats
// Splits raw CSV content into named sections keyed by normalized section name

// Locale-variant section name normalization
const SECTION_NAME_MAP: Record<string, string> = {
	vehicle: 'vehicle',
	log: 'log',
	refuelling: 'refuelling',
	reabastecimiento: 'refuelling',
	service: 'service',
	servicio: 'service',
	expense: 'expense'
};

function normalizeSectionName(raw: string): string {
	const lower = raw.trim().toLowerCase();
	return SECTION_NAME_MAP[lower] ?? lower;
}

/**
 * Split a sectioned CSV (aCar/Fuelio or Drivvo format) into named sections.
 * Section markers: lines starting with ## or # followed by a section name.
 * Returns Map<normalizedName, csvContent> where csvContent is the lines after the marker.
 */
export function splitCSVSections(rawCSV: string): Map<string, string> {
	// Strip UTF-8 BOM
	let cleaned = rawCSV;
	if (cleaned.charCodeAt(0) === 0xfeff) {
		cleaned = cleaned.slice(1);
	}

	// Normalize line endings to \n
	cleaned = cleaned.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

	const lines = cleaned.split('\n');
	const sections = new Map<string, string>();
	const sectionPattern = /^#{1,2}\s*(.+)/;

	let currentSection: string | null = null;
	let currentLines: string[] = [];

	for (const line of lines) {
		const match = sectionPattern.exec(line);
		if (match) {
			// Save previous section if any
			if (currentSection !== null) {
				sections.set(currentSection, currentLines.join('\n'));
			}
			currentSection = normalizeSectionName(match[1]);
			currentLines = [];
		} else if (currentSection !== null) {
			currentLines.push(line);
		}
		// Lines before first section marker are ignored
	}

	// Save the last section
	if (currentSection !== null) {
		sections.set(currentSection, currentLines.join('\n'));
	}

	return sections;
}
