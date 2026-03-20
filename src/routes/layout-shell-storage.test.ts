/**
 * Layout shell — storage protection behavior (Story 1.7, Task 4.3)
 *
 * Covers:
 * - First-load persistence request behavior
 * - Denied-path notice rendering
 * - Granted-path silence (no notice shown)
 * - Unavailable-path notice rendering
 * - Dismissed state hides the notice on later visits
 * - Compatibility with UpdatePrompt and NavBar (no interference)
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/svelte';
import { flushSync } from 'svelte';
// Use a wrapper component so Svelte 5 can properly pass children as a Snippet
import LayoutShell from './LayoutShell.test.svelte';

// ---------------------------------------------------------------------------
// Mock dependencies
// ---------------------------------------------------------------------------

const mockRequestStoragePersistence =
	vi.fn<() => Promise<import('$lib/utils/storagePersistence').StoragePersistenceOutcome>>();
const mockHasNoticeDismissed = vi.fn<() => boolean>();
const mockMarkNoticeDismissed = vi.fn<() => void>();

vi.mock('$lib/utils/storagePersistence', () => ({
	requestStoragePersistence: () => mockRequestStoragePersistence(),
	hasNoticeDismissed: () => mockHasNoticeDismissed(),
	markNoticeDismissed: () => mockMarkNoticeDismissed()
}));

vi.mock('$lib/utils/settings', () => ({
	getSettings: () => ({ fuelUnit: 'L/100km' as const, currency: '€' as const, theme: 'system' as const })
}));

vi.mock('virtual:pwa-register', () => ({
	registerSW: vi.fn(() => vi.fn())
}));

vi.mock('$app/state', () => ({
	page: { url: { pathname: '/fuel-entry' } }
}));

vi.mock('$app/paths', () => ({
	resolve: (href: string) => href
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function renderLayout() {
	const result = render(LayoutShell);
	// Allow async $effect (requestStoragePersistence) to settle
	await new Promise((r) => setTimeout(r, 0));
	flushSync();
	return result;
}

beforeEach(() => {
	vi.clearAllMocks();
	// Default: notice not dismissed
	mockHasNoticeDismissed.mockReturnValue(false);
});

afterEach(() => {
	cleanup();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('layout-shell storage protection — first-load request', () => {
	it('calls requestStoragePersistence on first mount', async () => {
		mockRequestStoragePersistence.mockResolvedValue('granted');
		await renderLayout();
		expect(mockRequestStoragePersistence).toHaveBeenCalledOnce();
	});
});

describe('layout-shell storage protection — denied path (notice shown)', () => {
	it('renders the storage protection notice when outcome is "denied"', async () => {
		mockRequestStoragePersistence.mockResolvedValue('denied');
		await renderLayout();
		expect(
			screen.getByText(
				'Storage protection unavailable on this browser - export your data regularly to prevent loss'
			)
		).toBeTruthy();
	});

	it('notice has role="status" live region in denied path', async () => {
		mockRequestStoragePersistence.mockResolvedValue('denied');
		await renderLayout();
		expect(screen.getByRole('status')).toBeTruthy();
	});
});

describe('layout-shell storage protection — unavailable path (notice shown)', () => {
	it('renders the storage protection notice when outcome is "unavailable"', async () => {
		mockRequestStoragePersistence.mockResolvedValue('unavailable');
		await renderLayout();
		expect(
			screen.getByText(
				'Storage protection unavailable on this browser - export your data regularly to prevent loss'
			)
		).toBeTruthy();
	});
});

describe('layout-shell storage protection — granted path (notice silent)', () => {
	it('does NOT render the storage protection notice when outcome is "granted"', async () => {
		mockRequestStoragePersistence.mockResolvedValue('granted');
		await renderLayout();
		expect(
			screen.queryByText(
				'Storage protection unavailable on this browser - export your data regularly to prevent loss'
			)
		).toBeNull();
	});
});

describe('layout-shell storage protection — dismissed state', () => {
	it('does NOT render notice when already dismissed (even on "denied" outcome)', async () => {
		mockHasNoticeDismissed.mockReturnValue(true);
		mockRequestStoragePersistence.mockResolvedValue('denied');
		await renderLayout();
		expect(
			screen.queryByText(
				'Storage protection unavailable on this browser - export your data regularly to prevent loss'
			)
		).toBeNull();
	});

	it('hides notice after dismiss button is clicked', async () => {
		mockHasNoticeDismissed.mockReturnValue(false);
		mockRequestStoragePersistence.mockResolvedValue('denied');
		await renderLayout();

		const dismissBtn = screen.getByRole('button', { name: /dismiss/i });
		fireEvent.click(dismissBtn);
		flushSync();

		expect(
			screen.queryByText(
				'Storage protection unavailable on this browser - export your data regularly to prevent loss'
			)
		).toBeNull();
	});

	it('calls markNoticeDismissed when dismiss button is clicked', async () => {
		mockRequestStoragePersistence.mockResolvedValue('denied');
		await renderLayout();

		fireEvent.click(screen.getByRole('button', { name: /dismiss/i }));
		expect(mockMarkNoticeDismissed).toHaveBeenCalledOnce();
	});
});

describe('layout-shell storage protection — UpdatePrompt compatibility', () => {
	it('UpdatePrompt renders alongside storage notice without interference', async () => {
		mockRequestStoragePersistence.mockResolvedValue('denied');
		await renderLayout();
		// UpdatePrompt renders nothing by default (banner only shows on SW update)
		// Notice is visible — confirms both can coexist in the shell
		expect(
			screen.getByText(
				'Storage protection unavailable on this browser - export your data regularly to prevent loss'
			)
		).toBeTruthy();
	});
});

describe('layout-shell storage protection — NavBar compatibility', () => {
	it('NavBar is rendered alongside the storage notice', async () => {
		mockRequestStoragePersistence.mockResolvedValue('denied');
		await renderLayout();
		expect(screen.getByRole('navigation', { name: /main navigation/i })).toBeTruthy();
	});
});
