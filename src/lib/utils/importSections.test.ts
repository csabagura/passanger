import { describe, it, expect } from 'vitest';
import { splitCSVSections } from './importSections';

describe('splitCSVSections', () => {
	it('extracts vehicle and log sections from aCar format', () => {
		const csv = `## Vehicle
"Name","DistUnit","FuelUnit"
"Toyota","0","0"

## Log
"Data","Odo (km)","Fuel (litres)"
"2018-10-07","424","33.04"`;

		const sections = splitCSVSections(csv);
		expect(sections.size).toBe(2);
		expect(sections.has('vehicle')).toBe(true);
		expect(sections.has('log')).toBe(true);
		expect(sections.get('vehicle')).toContain('"Toyota"');
		expect(sections.get('log')).toContain('"2018-10-07"');
	});

	it('extracts refuelling, service, expense, vehicle sections from Drivvo format', () => {
		const csv = `##Refuelling
Odometer,Date,Fuel type
12345,5/3/2024,gasoline

##Service
Odometer,Date,Cost,Title
12500,10/3/2024,150.00,Oil change

##Expense
Odometer,Date,Cost,Title
12600,15/3/2024,45.00,Parking

##Vehicle
Name,Model
My Car,Honda Civic`;

		const sections = splitCSVSections(csv);
		expect(sections.size).toBe(4);
		expect(sections.has('refuelling')).toBe(true);
		expect(sections.has('service')).toBe(true);
		expect(sections.has('expense')).toBe(true);
		expect(sections.has('vehicle')).toBe(true);
	});

	it('normalizes Spanish locale section names', () => {
		const csv = `#Reabastecimiento
Odometer,Date,Fuel type
12345,5/3/2024,gasoline

#Servicio
Odometer,Date,Cost,Title
12500,10/3/2024,150.00,Oil change`;

		const sections = splitCSVSections(csv);
		expect(sections.has('refuelling')).toBe(true);
		expect(sections.has('service')).toBe(true);
	});

	it('strips UTF-8 BOM before parsing', () => {
		const csv = `\uFEFF## Vehicle
"Name","DistUnit"
"Toyota","0"

## Log
"Data","Odo (km)"
"2018-10-07","424"`;

		const sections = splitCSVSections(csv);
		expect(sections.has('vehicle')).toBe(true);
		expect(sections.has('log')).toBe(true);
	});

	it('handles CRLF line endings', () => {
		const csv = '## Vehicle\r\n"Name"\r\n"Toyota"\r\n\r\n## Log\r\n"Data"\r\n"2018-10-07"';

		const sections = splitCSVSections(csv);
		expect(sections.size).toBe(2);
		expect(sections.has('vehicle')).toBe(true);
		expect(sections.has('log')).toBe(true);
	});

	it('handles empty section (marker followed by another marker)', () => {
		const csv = `## Vehicle

## Log
"Data","Odo (km)"
"2018-10-07","424"`;

		const sections = splitCSVSections(csv);
		expect(sections.has('vehicle')).toBe(true);
		expect(sections.get('vehicle')?.trim()).toBe('');
		expect(sections.has('log')).toBe(true);
		expect(sections.get('log')).toContain('"2018-10-07"');
	});

	it('ignores lines before first section marker', () => {
		const csv = `Some preamble text
Another line
## Vehicle
"Name"
"Toyota"`;

		const sections = splitCSVSections(csv);
		expect(sections.size).toBe(1);
		expect(sections.has('vehicle')).toBe(true);
		expect(sections.get('vehicle')).not.toContain('preamble');
	});

	it('returns empty map for content with no section markers', () => {
		const csv = 'col1,col2\nval1,val2';
		const sections = splitCSVSections(csv);
		expect(sections.size).toBe(0);
	});

	it('handles section marker with no space after ## (Drivvo style)', () => {
		const csv = `##Refuelling
Odometer,Date
12345,5/3/2024`;

		const sections = splitCSVSections(csv);
		expect(sections.has('refuelling')).toBe(true);
	});

	it('handles section marker with space after ## (aCar style)', () => {
		const csv = `## Vehicle
"Name"
"Toyota"`;

		const sections = splitCSVSections(csv);
		expect(sections.has('vehicle')).toBe(true);
	});

	it('preserves content within sections including empty lines', () => {
		const csv = `## Log
"Data","Odo (km)"

"2018-10-07","424"
"2018-10-14","850"`;

		const sections = splitCSVSections(csv);
		const logContent = sections.get('log')!;
		expect(logContent).toContain('"2018-10-07"');
		expect(logContent).toContain('"2018-10-14"');
	});

	it('handles unknown section names by preserving lowercased name', () => {
		const csv = `## CustomSection
data here`;

		const sections = splitCSVSections(csv);
		expect(sections.has('customsection')).toBe(true);
	});
});
