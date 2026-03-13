import { render, screen, within } from '@testing-library/svelte';
import { describe, expect, it } from 'vitest';
import StatBar from './StatBar.svelte';

describe('StatBar', () => {
	it('renders a selected-period hero label with the required 32px emphasis and accessible label', () => {
		render(StatBar, {
			summary: {
				totalSpend: 242,
				totalFuelVolume: 72,
				fuelVolumeUnit: 'L',
				averageConsumption: 7.2,
				averageConsumptionUnit: 'L'
			},
			selectedPeriodTotal: 198,
			selectedPeriodLabel: 'This year',
			selectedPeriodAriaLabel: 'Fuel costs for this year',
			currency: 'EUR '
		});

		const heroTotal = screen.getByText('EUR 198.00');
		expect(screen.getByText('This year')).toBeTruthy();
		expect(screen.getByLabelText('Fuel costs for this year: EUR 198.00')).toBeTruthy();
		expect(heroTotal.className).toContain('text-[2rem]');
		expect(screen.queryByText('March 2026')).toBeNull();
	});

	it('renders average consumption in MPG when averageConsumptionUnit is gal', () => {
		render(StatBar, {
			summary: {
				totalSpend: 60,
				totalFuelVolume: 8,
				fuelVolumeUnit: 'gal',
				averageConsumption: 32.7,
				averageConsumptionUnit: 'gal'
			},
			selectedPeriodTotal: 60,
			selectedPeriodLabel: 'All time',
			selectedPeriodAriaLabel: 'Fuel costs for all time',
			currency: '€'
		});

		expect(screen.getByText('32.7 MPG')).toBeTruthy();
		expect(screen.queryByText(/L\/100km/i)).toBeNull();
	});

	it('renders zero selected-period totals and preserves dl semantics when averages are unavailable', () => {
		const { container } = render(StatBar, {
			summary: {
				totalSpend: 120,
				totalFuelVolume: 0,
				fuelVolumeUnit: 'L',
				averageConsumption: null,
				averageConsumptionUnit: 'L'
			},
			selectedPeriodTotal: 0,
			selectedPeriodLabel: 'All time',
			selectedPeriodAriaLabel: 'Maintenance costs for all time',
			currency: 'EUR '
		});

		expect(screen.getByLabelText('Maintenance costs for all time: EUR 0.00')).toBeTruthy();
		expect(screen.getByText('All time')).toBeTruthy();
		expect(screen.getByText('No data')).toBeTruthy();

		const summaryList = container.querySelector('dl');
		expect(summaryList).toBeTruthy();
		expect(within(summaryList as HTMLElement).getByText('Total spend')).toBeTruthy();
		expect(within(summaryList as HTMLElement).getByText('Fuel volume')).toBeTruthy();
		expect(within(summaryList as HTMLElement).getByText('Avg consumption')).toBeTruthy();
	});
});
