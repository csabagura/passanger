import { describe, it, expect } from 'vitest';
import { detectCSVFormat } from './importDetect';

describe('detectCSVFormat', () => {
	it('detects aCar/Fuelio format from "## Vehicle" header', () => {
		const csv = '## Vehicle: Honda Civic\nDate,Odometer,Litres\n2024-01-01,10000,45';
		const result = detectCSVFormat(csv);
		expect(result.error).toBeNull();
		expect(result.data).toBe('acar');
	});

	it('detects Drivvo format from "##Refuelling" header', () => {
		const csv = '##Refuelling\nDate,Odometer,Quantity\n2024-01-01,10000,45';
		const result = detectCSVFormat(csv);
		expect(result.error).toBeNull();
		expect(result.data).toBe('drivvo');
	});

	it('detects Drivvo format from "#Reabastecimiento" header (Spanish)', () => {
		const csv = '#Reabastecimiento\nFecha,Odómetro,Cantidad\n2024-01-01,10000,45';
		const result = detectCSVFormat(csv);
		expect(result.error).toBeNull();
		expect(result.data).toBe('drivvo');
	});

	it('detects Drivvo format from "##Service" header', () => {
		const csv = '##Service\nDate,Description,Cost\n2024-01-01,Oil Change,50';
		const result = detectCSVFormat(csv);
		expect(result.error).toBeNull();
		expect(result.data).toBe('drivvo');
	});

	it('detects Drivvo format from "#Servicio" header (Spanish)', () => {
		const csv = '#Servicio\nFecha,Descripción,Costo\n2024-01-01,Cambio aceite,50';
		const result = detectCSVFormat(csv);
		expect(result.error).toBeNull();
		expect(result.data).toBe('drivvo');
	});

	it('detects Fuelly format from "fuelup_date" in header', () => {
		const csv = 'fuelup_date,gallons,price,mpg\n2024-01-01,10.5,35.00,28.5';
		const result = detectCSVFormat(csv);
		expect(result.error).toBeNull();
		expect(result.data).toBe('fuelly');
	});

	it('detects Fuelly format from "city_percentage" in header', () => {
		const csv = 'date,gallons,city_percentage,mpg\n2024-01-01,10.5,50,28.5';
		const result = detectCSVFormat(csv);
		expect(result.error).toBeNull();
		expect(result.data).toBe('fuelly');
	});

	it('returns generic for unknown CSV format', () => {
		const csv = 'date,amount,description\n2024-01-01,50,Fuel';
		const result = detectCSVFormat(csv);
		expect(result.error).toBeNull();
		expect(result.data).toBe('generic');
	});

	it('returns generic for empty content', () => {
		const result = detectCSVFormat('');
		expect(result.error).toBeNull();
		expect(result.data).toBe('generic');
	});

	it('handles content with Windows line endings', () => {
		const csv = '## Vehicle: Honda\r\nDate,Odometer\r\n2024-01-01,10000';
		const result = detectCSVFormat(csv);
		expect(result.error).toBeNull();
		expect(result.data).toBe('acar');
	});

	it('is case-insensitive for Drivvo detection', () => {
		const csv = '##REFUELLING\nDate,Odometer\n2024-01-01,10000';
		const result = detectCSVFormat(csv);
		expect(result.error).toBeNull();
		expect(result.data).toBe('drivvo');
	});

	it('is case-insensitive for Fuelly header detection', () => {
		const csv = 'Fuelup_Date,Gallons,Price\n2024-01-01,10.5,35.00';
		const result = detectCSVFormat(csv);
		expect(result.error).toBeNull();
		expect(result.data).toBe('fuelly');
	});
});
