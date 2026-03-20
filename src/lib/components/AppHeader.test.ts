import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/svelte';
import AppHeader from './AppHeader.svelte';

let mockPathname = '/log';
let mockBasePath = '';

vi.mock('$app/state', () => ({
	page: {
		get url() {
			return new URL(`http://localhost${mockPathname}`);
		}
	}
}));

vi.mock('$app/paths', () => ({
	resolve: (path: string) => mockBasePath + path
}));

vi.mock('$app/navigation', () => ({
	goto: vi.fn()
}));

const testVehicle = { id: 1, name: 'My Car', make: 'Honda', model: 'Civic', year: 2020 };

function makeVehiclesContext(vehicles = [testVehicle], activeId: number | null = 1) {
	return {
		get vehicles() {
			return vehicles;
		},
		get activeVehicle() {
			return activeId !== null ? (vehicles.find((v) => v.id === activeId) ?? null) : null;
		},
		get activeVehicleId() {
			return activeId;
		},
		get loaded() {
			return true;
		},
		switchVehicle: vi.fn(),
		refreshVehicles: vi.fn()
	};
}

function renderHeader(vehiclesCtx = makeVehiclesContext()) {
	const contextMap = new Map<string, unknown>();
	contextMap.set('vehicles', vehiclesCtx);
	return render(AppHeader, { context: contextMap });
}

describe('AppHeader', () => {
	beforeEach(() => {
		mockPathname = '/log';
		mockBasePath = '';
	});

	it('renders screen title and settings link', () => {
		renderHeader();
		expect(screen.getByText('Log')).toBeTruthy();
		const settingsLink = screen.getByRole('link', { name: 'Settings' });
		expect(settingsLink).toBeTruthy();
		expect(settingsLink.getAttribute('href')).toBe('/settings');
	});

	it('derives title from /history route', () => {
		mockPathname = '/history';
		renderHeader();
		expect(screen.getByText('History')).toBeTruthy();
	});

	it('derives title from /analytics route', () => {
		mockPathname = '/analytics';
		renderHeader();
		expect(screen.getByText('Analytics')).toBeTruthy();
	});

	it('derives title from /export route', () => {
		mockPathname = '/export';
		renderHeader();
		expect(screen.getByText('Export')).toBeTruthy();
	});

	it('derives title from /settings route', () => {
		mockPathname = '/settings';
		renderHeader();
		expect(screen.getByText('Settings')).toBeTruthy();
	});

	it('falls back to "passanger" for unknown routes', () => {
		mockPathname = '/unknown';
		renderHeader();
		expect(screen.getByText('passanger')).toBeTruthy();
	});

	it('marks settings link as active on /settings', () => {
		mockPathname = '/settings';
		renderHeader();
		const settingsLink = screen.getByRole('link', { name: 'Settings' });
		expect(settingsLink.getAttribute('aria-current')).toBe('page');
	});

	it('does not mark settings link as active on other routes', () => {
		mockPathname = '/log';
		renderHeader();
		const settingsLink = screen.getByRole('link', { name: 'Settings' });
		expect(settingsLink.getAttribute('aria-current')).toBeNull();
	});

	it('has accessible header landmark', () => {
		renderHeader();
		const header = screen.getByRole('banner');
		expect(header).toBeTruthy();
	});

	it('resolves settings href with base path', () => {
		mockBasePath = '/app';
		mockPathname = '/app/log';
		renderHeader();
		const settingsLink = screen.getByRole('link', { name: 'Settings' });
		expect(settingsLink.getAttribute('href')).toBe('/app/settings');
	});

	it('renders VehicleSwitcher pill with active vehicle name', () => {
		renderHeader();
		expect(screen.getByText('My Car')).toBeTruthy();
	});

	it('renders VehicleSwitcher pill with "No vehicle" fallback when no vehicles exist', () => {
		renderHeader(makeVehiclesContext([], null));
		expect(screen.getByText('No vehicle')).toBeTruthy();
	});
});
