import { describe, it, expect } from 'vitest';
import {
	calculateConsumption,
	convertConsumptionUnit,
	formatConsumption,
	formatConsumptionForDisplay,
	formatCurrency,
	getDistanceUnitForFuelUnit,
	getVolumeUnitForFuelUnit
} from './calculations';

describe('calculateConsumption', () => {
	describe('L/100km consumption', () => {
		it('should calculate L/100km correctly', () => {
			const consumption = calculateConsumption(87400, 86800, 42, 'L');
			expect(consumption).toBeCloseTo(7.0, 1); // 42 / (87400 - 86800) * 100 = 7.0
		});

		it('should calculate L/100km with decimal quantity', () => {
			const consumption = calculateConsumption(100000, 99600, 20.5, 'L');
			expect(consumption).toBeCloseTo(5.125, 2); // 20.5 / 400 * 100 = 5.125
		});

		it('should handle zero consumption (same odometer)', () => {
			const consumption = calculateConsumption(87400, 87400, 42, 'L');
			expect(consumption).toBe(0);
		});

		it('should handle zero consumption (negative delta)', () => {
			const consumption = calculateConsumption(87000, 87400, 42, 'L');
			expect(consumption).toBe(0);
		});

		it('should handle zero consumption (zero quantity)', () => {
			const consumption = calculateConsumption(87400, 86800, 0, 'L');
			expect(consumption).toBe(0);
		});

		it('should handle zero consumption (negative quantity)', () => {
			const consumption = calculateConsumption(87400, 86800, -10, 'L');
			expect(consumption).toBe(0);
		});
	});

	describe('MPG consumption', () => {
		it('should calculate MPG correctly', () => {
			const consumption = calculateConsumption(87400, 86800, 10.5, 'gal');
			expect(consumption).toBeCloseTo(57.14, 1); // 600 / 10.5 = 57.14
		});

		it('should calculate MPG with decimal distance', () => {
			const consumption = calculateConsumption(100000.5, 99600, 20.25, 'gal');
			expect(consumption).toBeCloseTo(19.75, 1); // 400.5 / 20.25 = 19.75
		});

		it('should handle zero consumption (same odometer) - MPG', () => {
			const consumption = calculateConsumption(87400, 87400, 10.5, 'gal');
			expect(consumption).toBe(0);
		});

		it('should handle zero consumption (zero quantity) - MPG', () => {
			const consumption = calculateConsumption(87400, 86800, 0, 'gal');
			expect(consumption).toBe(0);
		});
	});

	describe('first-ever entry (no previous odometer)', () => {
		it('should return 0 when previousOdometer is 0', () => {
			const consumption = calculateConsumption(87400, 0, 42, 'L');
			expect(consumption).toBe(0);
		});

		it('should return 0 when previousOdometer is undefined (treated as 0)', () => {
			const consumption = calculateConsumption(87400, undefined as unknown as number, 42, 'L');
			expect(consumption).toBe(0);
		});

		it('should return 0 when previousOdometer is null (treated as 0)', () => {
			const consumption = calculateConsumption(87400, null as unknown as number, 42, 'L');
			expect(consumption).toBe(0);
		});
	});

	describe('edge cases', () => {
		it('should handle very large values', () => {
			const consumption = calculateConsumption(1000000, 999000, 100, 'L');
			expect(consumption).toBeCloseTo(10.0, 1); // 100 / 1000 * 100 = 10.0
		});

		it('should handle very small distance', () => {
			const consumption = calculateConsumption(100.5, 100, 2, 'L');
			expect(consumption).toBeCloseTo(400.0, 0); // 2 / 0.5 * 100 = 400
		});

		it('should handle decimal odometer values', () => {
			const consumption = calculateConsumption(87400.75, 86800.25, 42, 'L');
			expect(consumption).toBeCloseTo(7.0, 1); // 42 / 600.5 * 100 ≈ 6.99
		});
	});
});

describe('formatConsumption', () => {
	it('should format L/100km with 1 decimal place', () => {
		const formatted = formatConsumption(7.0, 'L');
		expect(formatted).toBe('7.0 L/100km');
	});

	it('should format L/100km with rounding', () => {
		const formatted = formatConsumption(7.25, 'L');
		expect(formatted).toBe('7.3 L/100km');
	});

	it('should format L/100km with zero value', () => {
		const formatted = formatConsumption(0, 'L');
		expect(formatted).toBe('0.0 L/100km');
	});

	it('should format MPG with 1 decimal place', () => {
		const formatted = formatConsumption(57.14, 'gal');
		expect(formatted).toBe('57.1 MPG');
	});

	it('should format MPG with rounding', () => {
		const formatted = formatConsumption(57.95, 'gal');
		expect(formatted).toBe('58.0 MPG');
	});

	it('should format MPG with zero value', () => {
		const formatted = formatConsumption(0, 'gal');
		expect(formatted).toBe('0.0 MPG');
	});

	it('should handle very small L/100km values', () => {
		const formatted = formatConsumption(4.1, 'L');
		expect(formatted).toBe('4.1 L/100km');
	});

	it('should handle very large MPG values', () => {
		const formatted = formatConsumption(99.9, 'gal');
		expect(formatted).toBe('99.9 MPG');
	});
});

describe('shared display helpers', () => {
	it('maps metric preferences to liters and kilometers', () => {
		expect(getVolumeUnitForFuelUnit('L/100km')).toBe('L');
		expect(getDistanceUnitForFuelUnit('L/100km')).toBe('km');
	});

	it('maps imperial preferences to gallons and miles', () => {
		expect(getVolumeUnitForFuelUnit('MPG')).toBe('gal');
		expect(getDistanceUnitForFuelUnit('MPG')).toBe('mi');
	});

	it('converts metric consumption values into MPG', () => {
		expect(convertConsumptionUnit(7.2, 'L', 'gal')).toBeCloseTo(32.6687, 4);
	});

	it('converts MPG values into metric consumption', () => {
		expect(convertConsumptionUnit(30, 'gal', 'L')).toBeCloseTo(7.8405, 4);
	});

	it('returns zero when conversion receives invalid or non-positive consumption', () => {
		expect(convertConsumptionUnit(0, 'L', 'gal')).toBe(0);
		expect(convertConsumptionUnit(-2, 'gal', 'L')).toBe(0);
		expect(convertConsumptionUnit(Number.NaN, 'L', 'gal')).toBe(0);
	});

	it('returns the same value when fromUnit equals toUnit (identity conversion)', () => {
		expect(convertConsumptionUnit(7.2, 'L', 'L')).toBe(7.2);
		expect(convertConsumptionUnit(32.5, 'gal', 'gal')).toBe(32.5);
	});

	it('formats stored metric consumption using the preferred imperial unit', () => {
		expect(formatConsumptionForDisplay(7.2, 'L', 'MPG')).toBe('32.7 MPG');
	});

	it('formats stored imperial consumption using the preferred metric unit', () => {
		expect(formatConsumptionForDisplay(30, 'gal', 'L/100km')).toBe('7.8 L/100km');
	});

	it('formats currency using the literal saved prefix', () => {
		expect(formatCurrency(78, 'EUR ')).toBe('EUR 78.00');
	});
});
