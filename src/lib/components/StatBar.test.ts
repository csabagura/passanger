import { render, screen, within } from '@testing-library/svelte';
import { describe, expect, it } from 'vitest';
import { m } from '$lib/paraglide/messages';
import StatBar from './StatBar.svelte';

describe('StatBar', () => {
	it('renders a selected-period hero label with the required 32px emphasis and accessible label', () => {
		render(StatBar, {
			summary: {
				totalSpend: 242,
				totalSpendByCurrency: { 'EUR ': 242 },
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
				totalSpendByCurrency: { '€': 60 },
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
				totalSpendByCurrency: { 'EUR ': 120 },
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
		expect(screen.getByText(m.stat_no_data())).toBeTruthy();

		const summaryList = container.querySelector('dl');
		expect(summaryList).toBeTruthy();
		expect(within(summaryList as HTMLElement).getByText(m.stat_total_spend())).toBeTruthy();
		expect(within(summaryList as HTMLElement).getByText(m.stat_fuel_volume())).toBeTruthy();
		expect(within(summaryList as HTMLElement).getByText(m.stat_avg_consumption())).toBeTruthy();
	});

	it('shows the approximate converted home total only when multi-currency with a rate', () => {
		render(StatBar, {
			summary: {
				totalSpend: 0,
				totalSpendByCurrency: { Ft: 5000, '€': 100 },
				totalFuelVolume: 0,
				fuelVolumeUnit: 'L',
				averageConsumption: null,
				averageConsumptionUnit: 'L'
			},
			selectedPeriodTotal: 0,
			selectedPeriodLabel: 'All time',
			selectedPeriodAriaLabel: 'Total car costs for all time',
			currency: 'Ft',
			selectedPeriodSpendByCurrency: { Ft: 5000, '€': 100 },
			homeCurrency: 'Ft',
			convertedHomeTotal: { total: 45000, unconvertedEntries: 0 }
		});

		// Ft is a zero-decimal suffix currency → "45000 Ft".
		expect(screen.getByText(m.stat_converted_total({ amount: '45000 Ft' }))).toBeTruthy();
	});

	it('does not show the converted line for a single-currency view even if a total is passed', () => {
		render(StatBar, {
			summary: {
				totalSpend: 198,
				totalSpendByCurrency: { '€': 198 },
				totalFuelVolume: 0,
				fuelVolumeUnit: 'L',
				averageConsumption: null,
				averageConsumptionUnit: 'L'
			},
			selectedPeriodTotal: 198,
			selectedPeriodLabel: 'This year',
			selectedPeriodAriaLabel: 'Fuel costs for this year',
			currency: '€',
			selectedPeriodSpendByCurrency: { '€': 198 },
			homeCurrency: '€',
			convertedHomeTotal: { total: 198, unconvertedEntries: 0 }
		});

		expect(screen.queryByText(/your rates/)).toBeNull();
	});

	it('does not show the converted line when convertedHomeTotal is null', () => {
		render(StatBar, {
			summary: {
				totalSpend: 0,
				totalSpendByCurrency: { Ft: 5000, '€': 100 },
				totalFuelVolume: 0,
				fuelVolumeUnit: 'L',
				averageConsumption: null,
				averageConsumptionUnit: 'L'
			},
			selectedPeriodTotal: 0,
			selectedPeriodLabel: 'All time',
			selectedPeriodAriaLabel: 'Total car costs for all time',
			currency: 'Ft',
			selectedPeriodSpendByCurrency: { Ft: 5000, '€': 100 },
			homeCurrency: 'Ft',
			convertedHomeTotal: null
		});

		expect(screen.queryByText(/your rates/)).toBeNull();
	});

	it('appends an unconverted-entry note when some entries lack a rate', () => {
		render(StatBar, {
			summary: {
				totalSpend: 0,
				totalSpendByCurrency: { Ft: 5000, '€': 100, $: 50 },
				totalFuelVolume: 0,
				fuelVolumeUnit: 'L',
				averageConsumption: null,
				averageConsumptionUnit: 'L'
			},
			selectedPeriodTotal: 0,
			selectedPeriodLabel: 'All time',
			selectedPeriodAriaLabel: 'Total car costs for all time',
			currency: 'Ft',
			selectedPeriodSpendByCurrency: { Ft: 5000, '€': 100, $: 50 },
			homeCurrency: 'Ft',
			convertedHomeTotal: { total: 45000, unconvertedEntries: 2 }
		});

		expect(
			screen.getByText(
				`${m.stat_converted_total({ amount: '45000 Ft' })} ${m.stat_unconverted_suffix({ count: 2 })}`
			)
		).toBeTruthy();
	});
});
