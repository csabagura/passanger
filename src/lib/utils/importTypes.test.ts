import { describe, it, expect } from 'vitest';
import { isImportSource, isValidWizardStep, createInitialWizardState } from './importTypes';

describe('isImportSource', () => {
	it('returns true for valid sources', () => {
		expect(isImportSource('fuelly')).toBe(true);
		expect(isImportSource('acar')).toBe(true);
		expect(isImportSource('drivvo')).toBe(true);
		expect(isImportSource('generic')).toBe(true);
	});

	it('returns false for invalid strings', () => {
		expect(isImportSource('unknown')).toBe(false);
		expect(isImportSource('')).toBe(false);
		expect(isImportSource('Fuelly')).toBe(false);
	});

	it('returns false for non-string values', () => {
		expect(isImportSource(null)).toBe(false);
		expect(isImportSource(undefined)).toBe(false);
		expect(isImportSource(42)).toBe(false);
		expect(isImportSource(true)).toBe(false);
	});
});

describe('isValidWizardStep', () => {
	it('returns true for valid steps 1-6', () => {
		for (let step = 1; step <= 6; step++) {
			expect(isValidWizardStep(step)).toBe(true);
		}
	});

	it('returns false for out-of-range numbers', () => {
		expect(isValidWizardStep(0)).toBe(false);
		expect(isValidWizardStep(7)).toBe(false);
		expect(isValidWizardStep(-1)).toBe(false);
	});

	it('returns false for non-number values', () => {
		expect(isValidWizardStep('1')).toBe(false);
		expect(isValidWizardStep(null)).toBe(false);
		expect(isValidWizardStep(undefined)).toBe(false);
	});
});

describe('createInitialWizardState', () => {
	it('returns a state object with step 1 and all fields null/empty', () => {
		const state = createInitialWizardState();

		expect(state.step).toBe(1);
		expect(state.selectedSource).toBeNull();
		expect(state.file).toBeNull();
		expect(state.rawCSV).toBeNull();
		expect(state.detectedFormat).toBeNull();
		expect(state.confirmedFormat).toBeNull();
		expect(state.rowCount).toBe(0);
		expect(state.parsedRows).toEqual([]);
		expect(state.dryRunSummary).toBeNull();
		expect(state.vehicleId).toBeNull();
		expect(state.commitResult).toBeNull();
	});

	it('returns a new object each time (not shared reference)', () => {
		const a = createInitialWizardState();
		const b = createInitialWizardState();
		expect(a).not.toBe(b);
		expect(a.parsedRows).not.toBe(b.parsedRows);
	});
});
