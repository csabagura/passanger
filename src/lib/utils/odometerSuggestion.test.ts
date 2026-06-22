import { describe, it, expect } from 'vitest';
import { medianDelta, suggestNextOdometer, classifyOdometer } from './odometerSuggestion';

describe('medianDelta', () => {
	it('returns undefined for an empty array', () => {
		expect(medianDelta([])).toBeUndefined();
	});

	it('returns the single value for a one-element array', () => {
		expect(medianDelta([500])).toBe(500);
	});

	it('returns the middle value for an odd-count array', () => {
		expect(medianDelta([300, 500, 400])).toBe(400);
	});

	it('returns the average of the two middle values for an even-count array', () => {
		// sorted: [300, 400, 500, 600] → (400 + 500) / 2 = 450
		expect(medianDelta([600, 300, 500, 400])).toBe(450);
	});

	it('filters out zero and negative deltas before computing the median', () => {
		// only [400, 600] survive → (400 + 600) / 2 = 500
		expect(medianDelta([400, 0, -200, 600])).toBe(500);
	});

	it('returns undefined when every delta is non-positive', () => {
		expect(medianDelta([0, -100, -50])).toBeUndefined();
	});

	it('filters out non-finite deltas so corrupt data never yields a NaN suggestion', () => {
		// NaN / Infinity (e.g. from corrupt or imported odometers) must be discarded, not
		// dragged into the median — otherwise the form would seed the field with "NaN".
		expect(medianDelta([NaN, 500, Infinity, 700, -Infinity])).toBe(600);
		expect(medianDelta([NaN, Infinity])).toBeUndefined();
	});
});

describe('suggestNextOdometer', () => {
	it('returns undefined with no previous odometer (0 prior logs)', () => {
		expect(suggestNextOdometer(undefined, [])).toBeUndefined();
	});

	it('returns undefined with a previous odometer but no deltas (1 prior log)', () => {
		expect(suggestNextOdometer(87400, [])).toBeUndefined();
	});

	it('returns previousOdometer + medianDelta with >=2 prior logs', () => {
		// previous 87400 + median([500, 400, 600]) = 87400 + 500 = 87900
		expect(suggestNextOdometer(87400, [500, 400, 600])).toBe(87900);
	});

	it('rounds the suggestion to an integer', () => {
		// median([450, 451]) = 450.5 → 87400 + 450.5 = 87850.5 → 87851 (rounded)
		expect(suggestNextOdometer(87400, [450, 451])).toBe(87851);
	});

	it('returns undefined when only non-positive deltas exist', () => {
		expect(suggestNextOdometer(87400, [0, -10])).toBeUndefined();
	});
});

describe('classifyOdometer', () => {
	it('returns null when there is no comparable previous odometer', () => {
		expect(classifyOdometer(87400, undefined, 500)).toBeNull();
	});

	it('flags below-previous when value is strictly less than previous', () => {
		expect(classifyOdometer(87399, 87400, 500)).toBe('below-previous');
	});

	it('flags below-previous when value equals previous (<=)', () => {
		expect(classifyOdometer(87400, 87400, 500)).toBe('below-previous');
	});

	it('returns null for a normal forward reading within range', () => {
		// delta 500, typical 500 → well within 5x → no warning
		expect(classifyOdometer(87900, 87400, 500)).toBeNull();
	});

	it('flags implausibly-high when delta exceeds typicalDelta * multiplier', () => {
		// typical 500 → 5x = 2500; floor 2000 → max = 2500. delta 3000 > 2500 → warn
		expect(classifyOdometer(90400, 87400, 500)).toBe('implausibly-high');
	});

	it('does not flag implausibly-high when delta is at the threshold boundary', () => {
		// typical 500 → 2500 threshold; delta exactly 2500 is not > 2500 → null
		expect(classifyOdometer(89900, 87400, 500)).toBeNull();
	});

	it('uses the absolute floor when typicalDelta is undefined', () => {
		// no typical → floor 2000. delta 2500 > 2000 → warn
		expect(classifyOdometer(89900, 87400, undefined)).toBe('implausibly-high');
		// delta 1500 < 2000 floor → null
		expect(classifyOdometer(88900, 87400, undefined)).toBeNull();
	});

	it('respects the absolute floor even when 5x typical is smaller', () => {
		// typical 100 → 5x = 500, but floor 2000 wins → threshold 2000. delta 1500 → null
		expect(classifyOdometer(88900, 87400, 100)).toBeNull();
		// delta 2500 > 2000 floor → warn
		expect(classifyOdometer(89900, 87400, 100)).toBe('implausibly-high');
	});
});
