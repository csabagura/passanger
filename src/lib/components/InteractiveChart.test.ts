import { describe, it, expect, afterEach } from 'vitest';
import { cleanup, render, screen, within, fireEvent } from '@testing-library/svelte';
import InteractiveChart, { type ChartDatum } from './InteractiveChart.svelte';

function makePoints(...values: Array<Partial<ChartDatum>>): ChartDatum[] {
	return values.map((override, index) => ({
		label: override.label ?? `Point ${index + 1}`,
		value: override.value ?? index + 1,
		valueText: override.valueText ?? `€${index + 1}.00`,
		entryHref: override.entryHref
	}));
}

function renderChart(props: Record<string, unknown> = {}) {
	return render(InteractiveChart, {
		props: {
			title: 'Monthly spend',
			kind: 'bar' as const,
			ariaSummary: 'Spend per month.',
			emptyText: 'No data yet.',
			idBase: 'test-chart',
			points: makePoints({}, {}, {}),
			...props
		}
	});
}

afterEach(() => cleanup());

describe('InteractiveChart', () => {
	it('renders the heading', () => {
		renderChart();
		expect(screen.getByRole('heading', { name: 'Monthly spend' })).toBeTruthy();
	});

	it('renders a focusable button per datum with an accessible value name', () => {
		renderChart({
			points: makePoints(
				{ label: 'Jan', valueText: '€10.00' },
				{ label: 'Feb', valueText: '€20.00' }
			)
		});
		const jan = screen.getByRole('button', { name: 'Jan: €10.00' });
		const feb = screen.getByRole('button', { name: 'Feb: €20.00' });
		expect(jan.tagName).toBe('BUTTON'); // natively keyboard-operable (Enter/Space)
		expect(feb).toBeTruthy();
	});

	it('reveals the exact value + label when a datum is selected', async () => {
		renderChart({
			points: makePoints(
				{ label: 'Jan', valueText: '€10.00' },
				{ label: 'Feb', valueText: '€20.00' }
			)
		});
		await fireEvent.click(screen.getByRole('button', { name: 'Feb: €20.00' }));
		const status = screen.getByRole('status');
		expect(within(status).getByText('Feb')).toBeTruthy();
		expect(within(status).getByText('€20.00')).toBeTruthy();
	});

	it('shows a "View entry" link in the detail only when the datum has an entryHref', async () => {
		renderChart({
			kind: 'line',
			points: makePoints(
				{ label: '10 Mar', valueText: '7.0 L/100km', entryHref: '/history' },
				{ label: '12 Mar', valueText: '8.0 L/100km' }
			)
		});
		await fireEvent.click(screen.getByRole('button', { name: '10 Mar: 7.0 L/100km' }));
		expect(screen.getByRole('link', { name: 'View entry' }).getAttribute('href')).toBe('/history');

		await fireEvent.click(screen.getByRole('button', { name: '12 Mar: 8.0 L/100km' }));
		expect(screen.queryByRole('link', { name: 'View entry' })).toBeNull();
	});

	it('shows the value (not a chart path) for a single data point', () => {
		const { container } = renderChart({
			points: makePoints({ label: 'Mar', valueText: '€42.00' })
		});
		expect(screen.getByText('€42.00')).toBeTruthy();
		// No SVG line/area path is rendered for a single point.
		expect(container.querySelector('path')).toBeNull();
	});

	it('surfaces the "View entry" link for a single 1:1 datum in the chart view (not only via table)', () => {
		renderChart({
			points: makePoints({ label: 'Mar', valueText: '7.0 L/100km', entryHref: '/history' })
		});
		// Reachable directly in the default (non-table) single-point view — AC4.
		expect(screen.getByRole('link', { name: 'View entry' }).getAttribute('href')).toBe('/history');
	});

	it('omits the "View entry" link for a single aggregate datum (no entryHref)', () => {
		renderChart({ points: makePoints({ label: 'Mar', valueText: '€42.00' }) });
		expect(screen.queryByRole('link', { name: 'View entry' })).toBeNull();
	});

	it('renders the empty affordance for zero points', () => {
		renderChart({ points: [], emptyText: 'Add a second fill-up.' });
		expect(screen.getByText('Add a second fill-up.')).toBeTruthy();
		expect(screen.queryByRole('table')).toBeNull();
	});

	it('view-as-table toggle swaps the chart for a real table with a row per datum', async () => {
		renderChart({
			points: makePoints(
				{ label: 'Jan', valueText: '€10.00' },
				{ label: 'Feb', valueText: '€20.00' }
			)
		});
		const toggle = screen.getByRole('button', { name: 'View as table' });
		expect(toggle.getAttribute('aria-pressed')).toBe('false');

		await fireEvent.click(toggle);
		const table = screen.getByRole('table');
		expect(table).toBeTruthy();
		// One row per datum (+ the header row).
		expect(within(table).getAllByRole('row')).toHaveLength(3);
		expect(within(table).getByText('€20.00')).toBeTruthy();
		expect(screen.getByRole('button', { name: 'View as chart' }).getAttribute('aria-pressed')).toBe(
			'true'
		);
	});

	it('the table exposes "View entry" links for 1:1 datums', async () => {
		renderChart({
			kind: 'line',
			points: makePoints({ label: '10 Mar', valueText: '7.0 L/100km', entryHref: '/history' })
		});
		await fireEvent.click(screen.getByRole('button', { name: 'View as table' }));
		const table = screen.getByRole('table');
		expect(within(table).getByRole('link', { name: 'View entry' }).getAttribute('href')).toBe(
			'/history'
		);
	});

	it('datum buttons are focusable (native button keyboard semantics)', () => {
		renderChart({
			points: makePoints(
				{ label: 'Jan', valueText: '€10.00' },
				{ label: 'Feb', valueText: '€20.00' }
			)
		});
		const button = screen.getByRole('button', { name: 'Feb: €20.00' });
		button.focus();
		expect(document.activeElement).toBe(button);
	});
});
