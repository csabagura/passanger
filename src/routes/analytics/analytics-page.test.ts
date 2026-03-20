import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/svelte';
import AnalyticsPage from './+page.svelte';

vi.mock('$app/paths', () => ({
	resolve: (path: string) => path
}));

let mockActiveVehicle: {
	id: number;
	name: string;
	make: string;
	model: string;
	year?: number;
} | null = null;

vi.mock('svelte', async (importOriginal) => {
	const actual = await importOriginal<typeof import('svelte')>();
	return {
		...actual,
		getContext: (key: string) => {
			if (key === 'vehicles') {
				return {
					get vehicles() {
						return mockActiveVehicle ? [mockActiveVehicle] : [];
					},
					get activeVehicle() {
						return mockActiveVehicle;
					},
					get activeVehicleId() {
						return mockActiveVehicle?.id ?? null;
					},
					get loaded() {
						return true;
					},
					switchVehicle: vi.fn(),
					refreshVehicles: vi.fn().mockResolvedValue(undefined)
				};
			}

			return undefined;
		}
	};
});

describe('Analytics page', () => {
	it('renders the analytics empty state placeholder', () => {
		render(AnalyticsPage);
		expect(screen.getByText('Analytics')).toBeTruthy();
		expect(screen.getByText(/Charts and trend insights are coming soon/)).toBeTruthy();
	});

	it('has accessible region landmark', () => {
		render(AnalyticsPage);
		expect(screen.getByRole('region', { name: 'Analytics empty state' })).toBeTruthy();
	});

	it('shows vehicle name when a vehicle is active', () => {
		mockActiveVehicle = {
			id: 7,
			name: 'Old Faithful',
			make: 'Ford',
			model: 'Mustang',
			year: 2016
		};
		render(AnalyticsPage);
		expect(screen.getByText('Old Faithful')).toBeTruthy();
		mockActiveVehicle = null;
	});

	it('does not show vehicle name when no vehicle is active', () => {
		mockActiveVehicle = null;
		render(AnalyticsPage);
		expect(screen.queryByText('Old Faithful')).toBeNull();
	});
});
