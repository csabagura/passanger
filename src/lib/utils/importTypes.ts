// Import wizard types and validation helpers
// Used across Stories 8.1–8.5 for CSV import flow

import type { NewVehicle } from '$lib/db/schema';

export type ImportSource = 'fuelly' | 'acar' | 'drivvo' | 'generic';

export type ImportRowStatus = 'valid' | 'warning' | 'error';

export interface NormalizedImportEntry {
	date: Date;
	odometer: number;
	quantity: number;
	unit: 'L' | 'gal';
	distanceUnit: 'km' | 'mi';
	totalCost: number;
	notes: string;
	type: 'fuel' | 'maintenance';
	maintenanceType?: string;
	sourceVehicleName?: string; // original vehicle name from CSV
}

export interface ImportRow {
	rowNumber: number;
	status: ImportRowStatus;
	data: Partial<NormalizedImportEntry>;
	issues: string[]; // human-readable: "Missing odometer reading", not MISSING_ODOMETER
}

export interface ImportDryRunSummary {
	totalRows: number;
	validCount: number;
	warningCount: number;
	errorCount: number;
	detectedVehicleNames: string[];
	dateRange: { start: Date; end: Date } | null;
}

export interface ImportCommitResult {
	fuelCount: number;
	maintenanceCount: number;
	skippedCount: number;
	vehiclesCreated: string[];
	vehiclesMatched: string[];
	totalImported: number;
}

export interface VehicleAssignment {
	sourceVehicleName: string;
	rowCount: number;
	assignmentType: 'existing' | 'new';
	existingVehicleId?: number;
	newVehicle?: NewVehicle;
}

export interface VehicleGroup {
	sourceVehicleName: string;
	rows: ImportRow[];
	rowCount: number;
}

export interface ReviewRowState {
	status: 'pending' | 'corrected' | 'skipped';
	correctedData: Partial<NormalizedImportEntry>;
	correctedIssues: string[];
	correctedStatus: ImportRowStatus;
}

export interface ImportWizardState {
	step: 1 | 2 | 3 | 4 | 5 | 6;
	selectedSource: ImportSource | null;
	file: File | null;
	rawCSV: string | null;
	detectedFormat: ImportSource | null;
	confirmedFormat: ImportSource | null;
	rowCount: number;
	parsedRows: ImportRow[];
	dryRunSummary: ImportDryRunSummary | null;
	vehicleId: number | null;
	commitResult: ImportCommitResult | null;
	vehicleAssignments: VehicleAssignment[];
}

// Shared by all parsers — moved from importParseFuelly.ts in Story 8.3
export interface ColumnMappingEntry {
	sourceColumn: string;
	targetField: string;
	status: 'mapped' | 'calculated' | 'ignored';
}

// Shared unit detection result — null for Drivvo (no unit info in file)
export interface DetectedUnits {
	fuel: 'L' | 'gal';
	distance: 'km' | 'mi';
}

// Unified parse result — all parsers return this shape
export interface ImportParseResult {
	rows: ImportRow[];
	summary: ImportDryRunSummary;
	detectedUnits: DetectedUnits | null;
	columnMapping: ColumnMappingEntry[];
}

const VALID_IMPORT_SOURCES: readonly ImportSource[] = [
	'fuelly',
	'acar',
	'drivvo',
	'generic'
] as const;

const VALID_WIZARD_STEPS = [1, 2, 3, 4, 5, 6] as const;

export function isImportSource(value: unknown): value is ImportSource {
	return typeof value === 'string' && VALID_IMPORT_SOURCES.includes(value as ImportSource);
}

export function isValidWizardStep(value: unknown): value is ImportWizardState['step'] {
	return typeof value === 'number' && (VALID_WIZARD_STEPS as readonly number[]).includes(value);
}

export function createInitialWizardState(): ImportWizardState {
	return {
		step: 1,
		selectedSource: null,
		file: null,
		rawCSV: null,
		detectedFormat: null,
		confirmedFormat: null,
		rowCount: 0,
		parsedRows: [],
		dryRunSummary: null,
		vehicleId: null,
		commitResult: null,
		vehicleAssignments: []
	};
}
