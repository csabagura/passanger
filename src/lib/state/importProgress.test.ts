import { describe, it, expect, beforeEach, vi } from 'vitest';
import { IMPORT_PROGRESS_STORAGE_KEY, DRAFT_STALE_DAYS } from '$lib/config';
import {
	saveImportProgress,
	loadImportProgress,
	clearImportProgress,
	type ImportProgressSatellites
} from './importProgress';
import {
	createInitialWizardState,
	type ImportWizardState,
	type ImportRow,
	type ReviewRowState
} from '$lib/utils/importTypes';

const MS_PER_DAY = 86_400_000;

beforeEach(() => {
	// jsdom provides a real localStorage. Stateless module → just clear; no re-hydration hook needed.
	localStorage.clear();
	vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeRow(date: Date): ImportRow {
	return {
		rowNumber: 1,
		status: 'valid',
		data: {
			date,
			odometer: 10000,
			quantity: 40,
			unit: 'L',
			distanceUnit: 'km',
			totalCost: 60,
			notes: '',
			type: 'fuel',
			sourceVehicleName: 'TestCar'
		},
		issues: []
	};
}

/** A representative Step-4 (Review) wizard state with real Date objects. */
function makeStep4State(): ImportWizardState {
	return {
		...createInitialWizardState(),
		step: 4,
		selectedSource: 'fuelly',
		file: new File(['x'], 'test.csv'), // dropped on save
		rawCSV: 'fuelup_date,odometer\n2024-01-01,10000',
		detectedFormat: 'fuelly',
		confirmedFormat: 'fuelly',
		rowCount: 1,
		parsedRows: [makeRow(new Date(2024, 0, 1))],
		dryRunSummary: {
			totalRows: 1,
			validCount: 1,
			warningCount: 0,
			errorCount: 0,
			detectedVehicleNames: ['TestCar'],
			dateRange: { start: new Date(2024, 0, 1), end: new Date(2024, 0, 15) }
		},
		vehicleAssignments: []
	};
}

const noSatellites: ImportProgressSatellites = { step4AutoSkipped: false, reviewEntries: null };

// ---------------------------------------------------------------------------
// Round-trip & projection (AC1, AC2, AC3)
// ---------------------------------------------------------------------------

describe('saveImportProgress / loadImportProgress round-trip', () => {
	it('restores step, source, format, rawCSV, rowCount, and assignments', () => {
		const state = makeStep4State();
		state.vehicleAssignments = [
			{
				sourceVehicleName: 'TestCar',
				rowCount: 1,
				assignmentType: 'existing',
				existingVehicleId: 7
			}
		];

		saveImportProgress(state, noSatellites);
		const restored = loadImportProgress();

		expect(restored).not.toBeNull();
		expect(restored!.state.step).toBe(4);
		expect(restored!.state.selectedSource).toBe('fuelly');
		expect(restored!.state.confirmedFormat).toBe('fuelly');
		expect(restored!.state.rawCSV).toBe(state.rawCSV);
		expect(restored!.state.rowCount).toBe(1);
		expect(restored!.state.vehicleAssignments).toEqual(state.vehicleAssignments);
	});

	it('drops the non-serializable File — file is null after resume (AC3)', () => {
		const state = makeStep4State();
		expect(state.file).toBeInstanceOf(File);

		saveImportProgress(state, noSatellites);

		// The persisted payload contains no `file` key at all.
		const raw = JSON.parse(localStorage.getItem(IMPORT_PROGRESS_STORAGE_KEY)!);
		expect('file' in raw.state).toBe(false);

		const restored = loadImportProgress();
		expect(restored!.state.file).toBeNull();
	});

	it('writes the documented envelope { version, updatedAt, state, ... }', () => {
		saveImportProgress(makeStep4State(), noSatellites);
		const raw = JSON.parse(localStorage.getItem(IMPORT_PROGRESS_STORAGE_KEY)!);
		expect(raw.version).toBe(1);
		expect(typeof raw.updatedAt).toBe('number');
		expect(raw.state.step).toBe(4);
	});
});

// ---------------------------------------------------------------------------
// Date revival (AC2)
// ---------------------------------------------------------------------------

describe('Date revival', () => {
	it('revives parsedRows[].data.date and dryRunSummary.dateRange to Date objects', () => {
		saveImportProgress(makeStep4State(), noSatellites);

		// Prove they were stringified to ISO on disk first.
		const raw = JSON.parse(localStorage.getItem(IMPORT_PROGRESS_STORAGE_KEY)!);
		expect(typeof raw.state.parsedRows[0].data.date).toBe('string');
		expect(typeof raw.state.dryRunSummary.dateRange.start).toBe('string');

		const restored = loadImportProgress();
		expect(restored!.state.parsedRows[0].data.date).toBeInstanceOf(Date);
		expect((restored!.state.parsedRows[0].data.date as Date).getTime()).toBe(
			new Date(2024, 0, 1).getTime()
		);
		expect(restored!.state.dryRunSummary!.dateRange!.start).toBeInstanceOf(Date);
		expect(restored!.state.dryRunSummary!.dateRange!.end).toBeInstanceOf(Date);
	});

	it('revives the satellite reviewEntries[][1].correctedData.date', () => {
		const review: ReviewRowState = {
			status: 'corrected',
			correctedData: { date: new Date(2024, 5, 10), odometer: 12345 },
			correctedIssues: [],
			correctedStatus: 'valid'
		};
		const satellites: ImportProgressSatellites = {
			step4AutoSkipped: true,
			reviewEntries: [[1, review]]
		};

		saveImportProgress(makeStep4State(), satellites);
		const restored = loadImportProgress();

		expect(restored!.step4AutoSkipped).toBe(true);
		expect(restored!.reviewEntries).not.toBeNull();
		expect(restored!.reviewEntries![0][0]).toBe(1);
		expect(restored!.reviewEntries![0][1].correctedData.date).toBeInstanceOf(Date);
		expect((restored!.reviewEntries![0][1].correctedData.date as Date).getTime()).toBe(
			new Date(2024, 5, 10).getTime()
		);
	});
});

// ---------------------------------------------------------------------------
// Staleness (AC6)
// ---------------------------------------------------------------------------

describe('staleness', () => {
	it('discards a payload older than DRAFT_STALE_DAYS whole and clears the key', () => {
		saveImportProgress(makeStep4State(), noSatellites);
		// Backdate updatedAt past the horizon.
		const raw = JSON.parse(localStorage.getItem(IMPORT_PROGRESS_STORAGE_KEY)!);
		raw.updatedAt = Date.now() - (DRAFT_STALE_DAYS + 1) * MS_PER_DAY;
		localStorage.setItem(IMPORT_PROGRESS_STORAGE_KEY, JSON.stringify(raw));

		expect(loadImportProgress()).toBeNull();
		expect(localStorage.getItem(IMPORT_PROGRESS_STORAGE_KEY)).toBeNull();
	});

	it('restores a payload just inside the horizon', () => {
		saveImportProgress(makeStep4State(), noSatellites);
		const raw = JSON.parse(localStorage.getItem(IMPORT_PROGRESS_STORAGE_KEY)!);
		raw.updatedAt = Date.now() - (DRAFT_STALE_DAYS - 1) * MS_PER_DAY;
		localStorage.setItem(IMPORT_PROGRESS_STORAGE_KEY, JSON.stringify(raw));

		expect(loadImportProgress()).not.toBeNull();
	});
});

// ---------------------------------------------------------------------------
// Defensive loads (AC2, AC5)
// ---------------------------------------------------------------------------

describe('defensive loads', () => {
	it('returns null on absent key', () => {
		expect(loadImportProgress()).toBeNull();
	});

	it('returns null (no throw) on corrupt JSON', () => {
		localStorage.setItem(IMPORT_PROGRESS_STORAGE_KEY, '{not json');
		expect(() => loadImportProgress()).not.toThrow();
		expect(loadImportProgress()).toBeNull();
	});

	it('returns null on an invalid wizard step', () => {
		const state = { ...makeStep4State(), step: 9 } as unknown as ImportWizardState;
		saveImportProgress(state, noSatellites);
		expect(loadImportProgress()).toBeNull();
	});

	it('returns null on an invalid source', () => {
		const state = { ...makeStep4State(), selectedSource: 'bogus' } as unknown as ImportWizardState;
		saveImportProgress(state, noSatellites);
		expect(loadImportProgress()).toBeNull();
	});

	it('refuses (and clears) a post-commit state', () => {
		const state: ImportWizardState = {
			...makeStep4State(),
			step: 6,
			commitResult: {
				fuelCount: 1,
				maintenanceCount: 0,
				skippedCount: 0,
				vehiclesCreated: [],
				vehiclesMatched: ['TestCar'],
				totalImported: 1
			}
		};
		saveImportProgress(state, noSatellites);

		expect(loadImportProgress()).toBeNull();
		expect(localStorage.getItem(IMPORT_PROGRESS_STORAGE_KEY)).toBeNull();
	});
});

// ---------------------------------------------------------------------------
// clear & quota (AC5, AC7)
// ---------------------------------------------------------------------------

describe('clear and quota', () => {
	it('clearImportProgress removes the key', () => {
		saveImportProgress(makeStep4State(), noSatellites);
		expect(localStorage.getItem(IMPORT_PROGRESS_STORAGE_KEY)).not.toBeNull();
		clearImportProgress();
		expect(localStorage.getItem(IMPORT_PROGRESS_STORAGE_KEY)).toBeNull();
	});

	it('does not throw when localStorage.setItem throws QuotaExceededError (AC7)', () => {
		const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementationOnce(() => {
			throw new DOMException('quota', 'QuotaExceededError');
		});
		expect(() => saveImportProgress(makeStep4State(), noSatellites)).not.toThrow();
		// A swallowed write means nothing persisted → not resumable, but no crash.
		expect(localStorage.getItem(IMPORT_PROGRESS_STORAGE_KEY)).toBeNull();
		spy.mockRestore();
	});
});
