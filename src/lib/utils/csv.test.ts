import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Expense, FuelLog } from '$lib/db/schema';
import { buildCSVFilename, buildHistoryExportCSV, downloadCSV } from './csv';

function createFuelEntry(overrides: Partial<FuelLog> = {}): FuelLog {
	return {
		id: overrides.id ?? 9,
		vehicleId: overrides.vehicleId ?? 7,
		date: overrides.date ?? new Date(2026, 2, 10, 12, 0, 0, 0),
		odometer: overrides.odometer ?? 87400,
		quantity: overrides.quantity ?? 42,
		unit: overrides.unit ?? 'L',
		distanceUnit: overrides.distanceUnit ?? 'km',
		totalCost: overrides.totalCost ?? 78.5,
		calculatedConsumption: overrides.calculatedConsumption ?? 7.25,
		notes: overrides.notes ?? ''
	};
}

function createMaintenanceEntry(overrides: Partial<Expense> = {}): Expense {
	return {
		id: overrides.id ?? 12,
		vehicleId: overrides.vehicleId ?? 7,
		date: overrides.date ?? new Date(2026, 2, 12, 12, 0, 0, 0),
		type: overrides.type ?? 'Oil Change',
		odometer: overrides.odometer,
		cost: overrides.cost ?? 120,
		notes: overrides.notes
	};
}

describe('csv utilities', () => {
	beforeEach(() => {
		vi.restoreAllMocks();
	});

	afterEach(() => {
		document.body.innerHTML = '';
	});

	it('serializes the exact header order and maps mixed history rows with blank maintenance-only cells', () => {
		const csv = buildHistoryExportCSV([
			{ kind: 'fuel', entry: createFuelEntry({ notes: 'Top off before road trip' }) },
			{
				kind: 'maintenance',
				entry: createMaintenanceEntry({
					type: 'Oil Change',
					date: new Date(2026, 2, 12, 12, 0, 0, 0)
				})
			}
		]);

		expect(csv).toBe(
			[
				'date,odometer,entry type,quantity,unit,cost,calculated consumption,notes',
				'2026-03-12,,Oil Change,,,120,,',
				'2026-03-10,87400,fuel,42,L,78.5,7.25,Top off before road trip'
			].join('\r\n')
		);
	});

	it('escapes commas, quotes, and line breaks per RFC 4180', () => {
		const csv = buildHistoryExportCSV([
			{
				kind: 'maintenance',
				entry: createMaintenanceEntry({
					type: 'Insurance, "Full"\nAnnual',
					notes: 'Line 1\nLine 2'
				})
			},
			{
				kind: 'fuel',
				entry: createFuelEntry({
					notes: 'Quoted "note", keep'
				})
			}
		]);

		expect(csv).toContain('"Insurance, ""Full""\nAnnual"');
		expect(csv).toContain('"Line 1\nLine 2"');
		expect(csv).toContain('"Quoted ""note"", keep"');
		expect(
			csv.startsWith('date,odometer,entry type,quantity,unit,cost,calculated consumption,notes\r\n')
		).toBe(true);
	});

	it('prefixes dangerous free-text cells with a tab inside quoted fields for spreadsheet safety', () => {
		const csv = buildHistoryExportCSV([
			{
				kind: 'maintenance',
				entry: createMaintenanceEntry({
					type: '=HYPERLINK("https://example.com")',
					notes: ' +SUM(1,2)'
				})
			},
			{
				kind: 'fuel',
				entry: createFuelEntry({
					notes: '@cmd'
				})
			},
			{
				kind: 'maintenance',
				entry: createMaintenanceEntry({
					id: 13,
					date: new Date(2026, 2, 9, 12, 0, 0, 0),
					type: '＝1+1',
					notes: '\n=SUM(1,2)'
				})
			},
			{
				kind: 'fuel',
				entry: createFuelEntry({
					id: 10,
					date: new Date(2026, 2, 8, 12, 0, 0, 0),
					notes: '-2+3'
				})
			}
		]);

		expect(csv).toContain('"\t=HYPERLINK(""https://example.com"")"');
		expect(csv).toContain('"\t +SUM(1,2)"');
		expect(csv).toContain('"\t@cmd"');
		expect(csv).toContain('"\t＝1+1"');
		expect(csv).toContain('"\t\n=SUM(1,2)"');
		expect(csv).toContain('"\t-2+3"');
	});

	it('builds the required export filename from the local export date', () => {
		expect(buildCSVFilename(new Date(2026, 2, 12, 8, 30, 0, 0))).toBe(
			'passanger-export-2026-03-12.csv'
		);
	});

	it('creates a blob URL, clicks a synthetic anchor, and revokes the URL after triggering download', async () => {
		vi.useFakeTimers();

		try {
			const createObjectURL = vi.fn<(blob: Blob) => string>(() => 'blob:mock-csv');
			const revokeObjectURL = vi.fn();
			const setTimeoutSpy = vi.spyOn(window, 'setTimeout');
			const clickSpy = vi
				.spyOn(HTMLAnchorElement.prototype, 'click')
				.mockImplementation(() => undefined);
			const appendChildSpy = vi.spyOn(document.body, 'appendChild');
			const removeSpy = vi.spyOn(HTMLElement.prototype, 'remove');

			Object.defineProperty(URL, 'createObjectURL', {
				value: createObjectURL,
				configurable: true,
				writable: true
			});
			Object.defineProperty(URL, 'revokeObjectURL', {
				value: revokeObjectURL,
				configurable: true,
				writable: true
			});

			downloadCSV('date,odometer\n2026-03-12,87400', 'passanger-export-2026-03-12.csv');

			expect(createObjectURL).toHaveBeenCalledTimes(1);
			const createdBlob = createObjectURL.mock.calls[0]?.[0];
			expect(createdBlob).toBeInstanceOf(Blob);
			if (!(createdBlob instanceof Blob)) {
				throw new Error('Expected downloadCSV to create a Blob');
			}
			const blobBytes = new Uint8Array(await createdBlob.arrayBuffer());
			expect(Array.from(blobBytes.slice(0, 3))).toEqual([0xef, 0xbb, 0xbf]);
			expect(new TextDecoder().decode(blobBytes)).toBe('date,odometer\n2026-03-12,87400');

			expect(appendChildSpy).toHaveBeenCalledTimes(1);
			const anchor = appendChildSpy.mock.calls[0][0] as HTMLAnchorElement;
			expect(anchor.download).toBe('passanger-export-2026-03-12.csv');
			expect(anchor.href).toBe('blob:mock-csv');
			expect(clickSpy).toHaveBeenCalledTimes(1);
			expect(setTimeoutSpy).toHaveBeenCalledWith(expect.any(Function), 30_000);
			expect(removeSpy).not.toHaveBeenCalled();
			expect(revokeObjectURL).not.toHaveBeenCalled();

			await vi.runAllTimersAsync();

			expect(removeSpy).toHaveBeenCalledTimes(1);
			expect(revokeObjectURL).toHaveBeenCalledWith('blob:mock-csv');
		} finally {
			vi.useRealTimers();
		}
	});
});
