import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/svelte';
import { flushSync } from 'svelte';
import { HISTORY_ENTRY_FILTER_STORAGE_KEY, RESULT_CARD_DISMISS_MS } from '$lib/config';
import HistoryPage from './+page.svelte';

const mockGetAllFuelLogs = vi.fn();
const mockGetAllExpenses = vi.fn();
const mockDeleteFuelLog = vi.fn();
const mockDeleteExpense = vi.fn();
const mockUpdateFuelLogsAtomic = vi.fn();
const mockUpdateExpense = vi.fn();
const scrollToMock = vi.fn();

vi.mock('$lib/db/repositories/fuelLogs', () => ({
	getAllFuelLogs: (...args: unknown[]) => mockGetAllFuelLogs(...args),
	saveFuelLog: vi.fn(),
	updateFuelLogsAtomic: (...args: unknown[]) => mockUpdateFuelLogsAtomic(...args),
	deleteFuelLog: (...args: unknown[]) => mockDeleteFuelLog(...args)
}));

vi.mock('$lib/db/repositories/expenses', () => ({
	getAllExpenses: (...args: unknown[]) => mockGetAllExpenses(...args),
	saveExpense: vi.fn(),
	updateExpense: (...args: unknown[]) => mockUpdateExpense(...args),
	deleteExpense: (...args: unknown[]) => mockDeleteExpense(...args)
}));

let mockSettingsFuelUnit: 'L/100km' | 'MPG' = 'L/100km';
let mockActiveVehicle: { id: number; name: string; make: string; model: string; year?: number } | null =
	null;
const mockSwitchVehicle = vi.fn();
const mockRefreshVehicles = vi.fn().mockResolvedValue(undefined);

vi.mock('svelte', async (importOriginal) => {
	const actual = await importOriginal<typeof import('svelte')>();
	return {
		...actual,
		getContext: (key: string) => {
			if (key === 'settings') {
				return {
					settings: {
						fuelUnit: mockSettingsFuelUnit,
						currency: 'EUR '
					}
				};
			}

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
					switchVehicle: mockSwitchVehicle,
					refreshVehicles: mockRefreshVehicles
				};
			}

			return undefined;
		}
	};
});

const localStorageMock = (() => {
	let store: Record<string, string> = {};
	return {
		getItem: (key: string) => store[key] ?? null,
		setItem: (key: string, value: string) => {
			store[key] = value;
		},
		removeItem: (key: string) => {
			delete store[key];
		},
		clear: () => {
			store = {};
		}
	};
})();

const sessionStorageMock = (() => {
	let store: Record<string, string> = {};
	return {
		getItem: (key: string) => store[key] ?? null,
		setItem: (key: string, value: string) => {
			store[key] = value;
		},
		removeItem: (key: string) => {
			delete store[key];
		},
		clear: () => {
			store = {};
		}
	};
})();

Object.defineProperty(globalThis, 'localStorage', { value: localStorageMock, writable: true });
Object.defineProperty(globalThis, 'sessionStorage', {
	value: sessionStorageMock,
	writable: true
});

class MockPointerEvent extends MouseEvent {
	pointerId: number;

	constructor(type: string, init: MouseEventInit & { pointerId?: number } = {}) {
		super(type, init);
		this.pointerId = init.pointerId ?? 1;
	}
}

async function settlePage() {
	// waitFor wraps the async draining in a retry loop with a clear timeout diagnostic,
	// so that if loadHistoryRoute gains additional async boundaries in the future, tests
	// fail with a descriptive message rather than silently asserting on stale state.
	await waitFor(
		async () => {
			await new Promise<void>((r) => setTimeout(r, 0));
			await new Promise<void>((r) => setTimeout(r, 0));
			flushSync();
		},
		{ timeout: 2000 }
	);
}

async function swipeLeft(card: HTMLElement, pointerId = 1) {
	await fireEvent.pointerDown(card, { pointerId, clientX: 200, clientY: 16 });
	await fireEvent.pointerMove(card, { pointerId, clientX: 120, clientY: 16 });
	await fireEvent.pointerUp(card, { pointerId, clientX: 120, clientY: 16 });
}

function getHistoryCards(): HTMLElement[] {
	return Array.from(document.querySelectorAll<HTMLElement>('[data-entry-key]'));
}

function getHistoryCardKeys(): Array<string | null> {
	return getHistoryCards().map((card) => card.getAttribute('data-entry-key'));
}

async function openHistoryDetail(entryLabel: RegExp) {
	await fireEvent.click(screen.getByRole('button', { name: entryLabel }));
	flushSync();
}

function getStatValue(label: string): string | null {
	const labelElement = screen.getByText(label);
	const valueElement =
		labelElement.tagName.toLowerCase() === 'dt'
			? labelElement.nextElementSibling
			: labelElement.previousElementSibling;
	return valueElement?.textContent?.replace(/\s+/g, ' ').trim() ?? null;
}

function getMonthSubtotal(label: string): string | null {
	return screen.getByRole('heading', { name: label }).parentElement?.textContent ?? null;
}

function getVisibleMonthGroupLabels(): string[] {
	return Array.from(document.querySelectorAll<HTMLElement>('[id^="history-month-group-"]'))
		.map((heading) => heading.textContent?.trim() ?? '')
		.filter(Boolean);
}

function formatCurrency(value: number): string {
	return `EUR ${value.toFixed(2)}`;
}

function formatHistoryMonthLabel(date: Date): string {
	return new Intl.DateTimeFormat(undefined, {
		month: 'long',
		year: 'numeric'
	}).format(date);
}

function createDateInRelativeMonth(monthOffset: number, day: number): Date {
	const now = new Date();
	return new Date(now.getFullYear(), now.getMonth() + monthOffset, day, 12, 0, 0, 0);
}

function setHistoryReferenceDate(referenceDate: Date): void {
	vi.useFakeTimers({ toFake: ['Date'] });
	vi.setSystemTime(referenceDate);
}

function setDocumentVisibilityState(value: DocumentVisibilityState): void {
	Object.defineProperty(document, 'visibilityState', {
		configurable: true,
		get: () => value
	});
}

const testVehicle = { id: 7, name: 'Old Faithful', make: 'Ford', model: 'Mustang', year: 2016 };
const testFuelEntry = {
	id: 2,
	vehicleId: 7,
	date: new Date(2026, 2, 9, 12, 0, 0, 0),
	odometer: 87400,
	quantity: 42,
	unit: 'L' as const,
	distanceUnit: 'km' as const,
	totalCost: 78,
	calculatedConsumption: 7.2,
	notes: ''
};
const testExpense = {
	id: 5,
	vehicleId: 7,
	date: new Date(2026, 2, 10, 12, 0, 0, 0),
	type: 'Oil Change',
	cost: 120
};

describe('History page', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockSettingsFuelUnit = 'L/100km';
		localStorageMock.clear();
		sessionStorageMock.clear();
		document.body.style.overflow = '';
		document.documentElement.style.overflow = '';
		setDocumentVisibilityState('visible');
		mockActiveVehicle = null;
		mockGetAllFuelLogs.mockResolvedValue({ data: [], error: null });
		mockGetAllExpenses.mockResolvedValue({ data: [], error: null });
		mockDeleteFuelLog.mockResolvedValue({
			data: { deletedLogId: 2, updatedLogs: [] },
			error: null
		});
		mockDeleteExpense.mockResolvedValue({ data: undefined, error: null });
		mockUpdateFuelLogsAtomic.mockResolvedValue({ data: [], error: null });
		mockUpdateExpense.mockResolvedValue({ data: undefined, error: null });
		Object.defineProperty(globalThis, 'sessionStorage', {
			value: sessionStorageMock,
			configurable: true,
			writable: true
		});
		Object.defineProperty(globalThis, 'scrollTo', {
			value: scrollToMock,
			configurable: true,
			writable: true
		});
		scrollToMock.mockReset();
		Object.defineProperty(globalThis, 'PointerEvent', {
			value: MockPointerEvent,
			configurable: true,
			writable: true
		});
		Object.defineProperty(HTMLElement.prototype, 'setPointerCapture', {
			value: vi.fn(),
			configurable: true
		});
		Object.defineProperty(HTMLElement.prototype, 'releasePointerCapture', {
			value: vi.fn(),
			configurable: true
		});
	});

	afterEach(() => {
		vi.useRealTimers();
		cleanup();
	});

	it('loads mixed history entries from vehicle context and repositories only', async () => {
		mockActiveVehicle = testVehicle;
		mockGetAllFuelLogs.mockResolvedValue({ data: [testFuelEntry], error: null });
		mockGetAllExpenses.mockResolvedValue({ data: [testExpense], error: null });

		const fetchSpy = vi.fn();
		Object.defineProperty(globalThis, 'fetch', {
			value: fetchSpy,
			configurable: true,
			writable: true
		});

		render(HistoryPage);
		await settlePage();

		expect(screen.getByRole('heading', { name: 'History' })).toBeTruthy();
		expect(screen.getByText(/Old Faithful/i)).toBeTruthy();
		expect(screen.queryByText('View your past entries here.')).toBeNull();
		expect(getHistoryCardKeys()).toEqual(['maintenance-5', 'fuel-2']);
		expect(fetchSpy).not.toHaveBeenCalled();
	});

	it('shows the no-vehicles empty state and skips repository list reads when no vehicle exists', async () => {
		mockActiveVehicle = null;

		render(HistoryPage);
		await settlePage();

		expect(screen.getByText('Add a vehicle to get started')).toBeTruthy();
		expect(screen.getByRole('link', { name: /go to settings/i }).getAttribute('href')).toBe(
			'/settings'
		);
		expect(mockGetAllFuelLogs).not.toHaveBeenCalled();
		expect(mockGetAllExpenses).not.toHaveBeenCalled();
	});

	it('shows the export recovery state when repository-backed history loading fails', async () => {
		mockActiveVehicle = testVehicle;
		mockGetAllFuelLogs.mockResolvedValue({
			data: undefined,
			error: { code: 'GET_FAILED', message: 'boom' }
		});

		render(HistoryPage);
		await settlePage();

		expect(screen.getByRole('alert')).toBeTruthy();
		expect(screen.getByText('Could not load your history')).toBeTruthy();
		expect(screen.getByRole('link', { name: /export my data/i }).getAttribute('href')).toBe(
			'/export'
		);
		expect(screen.queryByText(/No entries yet/)).toBeNull();
	});

	it('shows the deferred loading state only after 300ms of unresolved work', async () => {
		vi.useFakeTimers();

		mockActiveVehicle = testVehicle;
		let resolveFuelLogs:
			| ((value: { data: never[]; error: null }) => void)
			| undefined;
		mockGetAllFuelLogs.mockReturnValue(
			new Promise((resolve) => {
				resolveFuelLogs = resolve;
			})
		);
		mockGetAllExpenses.mockResolvedValue({ data: [], error: null });

		render(HistoryPage);
		flushSync();

		expect(screen.queryByText('Loading history...')).toBeNull();

		await vi.advanceTimersByTimeAsync(299);
		flushSync();
		expect(screen.queryByText('Loading history...')).toBeNull();

		await vi.advanceTimersByTimeAsync(1);
		flushSync();
		expect(screen.getByText('Loading history...')).toBeTruthy();

		resolveFuelLogs?.({ data: [], error: null });

		await Promise.resolve();
		await Promise.resolve();
		flushSync();
	});

	it('clicking Delete after swipe reveal arms the inline delete confirmation', async () => {
		mockActiveVehicle = testVehicle;
		mockGetAllFuelLogs.mockResolvedValue({ data: [testFuelEntry], error: null });
		mockGetAllExpenses.mockResolvedValue({ data: [], error: null });

		render(HistoryPage);
		await settlePage();

		const card = screen.getByRole('group', { name: /fuel entry, Mar 9, 2026/i });
		await fireEvent.pointerDown(card, { pointerId: 1, clientX: 200, clientY: 16 });
		await fireEvent.pointerMove(card, { pointerId: 1, clientX: 120, clientY: 16 });
		await fireEvent.pointerUp(card, { pointerId: 1, clientX: 120, clientY: 16 });

		const deleteButton = screen.getByRole('button', {
			name: /delete fuel entry from Mar 9, 2026/i
		});
		await fireEvent.click(deleteButton);
		flushSync();

		expect(screen.getByText('Delete this entry? This cannot be undone.')).toBeTruthy();
	});

	it('confirms delete: calls deleteFuelLog and removes the entry from the list', async () => {
		mockActiveVehicle = testVehicle;
		mockGetAllFuelLogs.mockResolvedValue({ data: [testFuelEntry], error: null });
		mockGetAllExpenses.mockResolvedValue({ data: [], error: null });

		render(HistoryPage);
		await settlePage();

		// Swipe to reveal
		const card = screen.getByRole('group', { name: /fuel entry, Mar 9, 2026/i });
		await fireEvent.pointerDown(card, { pointerId: 1, clientX: 200, clientY: 16 });
		await fireEvent.pointerMove(card, { pointerId: 1, clientX: 120, clientY: 16 });
		await fireEvent.pointerUp(card, { pointerId: 1, clientX: 120, clientY: 16 });

		// Arm delete
		await fireEvent.click(
			screen.getByRole('button', { name: /delete fuel entry from Mar 9, 2026/i })
		);
		flushSync();

		// Confirm delete
		await fireEvent.click(screen.getByRole('button', { name: /confirm delete/i }));
		await settlePage();

		expect(mockDeleteFuelLog).toHaveBeenCalledWith(testFuelEntry.id);
		expect(screen.queryByRole('group', { name: /fuel entry, Mar 9, 2026/i })).toBeNull();
	});

	it('cancels delete: dismisses confirmation without calling deleteFuelLog', async () => {
		mockActiveVehicle = testVehicle;
		mockGetAllFuelLogs.mockResolvedValue({ data: [testFuelEntry], error: null });
		mockGetAllExpenses.mockResolvedValue({ data: [], error: null });

		render(HistoryPage);
		await settlePage();

		// Swipe to reveal
		const card = screen.getByRole('group', { name: /fuel entry, Mar 9, 2026/i });
		await fireEvent.pointerDown(card, { pointerId: 1, clientX: 200, clientY: 16 });
		await fireEvent.pointerMove(card, { pointerId: 1, clientX: 120, clientY: 16 });
		await fireEvent.pointerUp(card, { pointerId: 1, clientX: 120, clientY: 16 });

		// Arm delete
		await fireEvent.click(
			screen.getByRole('button', { name: /delete fuel entry from Mar 9, 2026/i })
		);
		flushSync();

		// Cancel delete
		await fireEvent.click(screen.getByRole('button', { name: /cancel deleting/i }));
		flushSync();

		expect(mockDeleteFuelLog).not.toHaveBeenCalled();
		expect(screen.queryByText('Delete this entry? This cannot be undone.')).toBeNull();
		expect(screen.queryByRole('group', { name: /fuel entry, Mar 9, 2026/i })).toBeTruthy();
	});

	it('clicking Edit after swipe reveal shows the inline edit form heading', async () => {
		mockActiveVehicle = testVehicle;
		mockGetAllFuelLogs.mockResolvedValue({ data: [testFuelEntry], error: null });
		mockGetAllExpenses.mockResolvedValue({ data: [], error: null });

		render(HistoryPage);
		await settlePage();

		const card = screen.getByRole('group', { name: /fuel entry, Mar 9, 2026/i });
		await fireEvent.pointerDown(card, { pointerId: 1, clientX: 200, clientY: 16 });
		await fireEvent.pointerMove(card, { pointerId: 1, clientX: 120, clientY: 16 });
		await fireEvent.pointerUp(card, { pointerId: 1, clientX: 120, clientY: 16 });

		await fireEvent.click(
			screen.getByRole('button', { name: /edit fuel entry from Mar 9, 2026/i })
		);
		flushSync();

		expect(screen.getByRole('heading', { name: 'Editing fuel entry' })).toBeTruthy();
	});

	it('opens detail, preserves filter and time-period state on dismiss, returns focus, and does not scroll', async () => {
		mockActiveVehicle = testVehicle;
		mockGetAllFuelLogs.mockResolvedValue({ data: [testFuelEntry], error: null });
		mockGetAllExpenses.mockResolvedValue({ data: [testExpense], error: null });

		render(HistoryPage);
		await settlePage();

		await fireEvent.click(screen.getByRole('radio', { name: 'Fuel' }));
		await fireEvent.click(screen.getByRole('radio', { name: 'All time' }));
		flushSync();

		const historyContent = document.querySelector<HTMLElement>(
			'[data-history-page-content="true"]'
		);
		expect(historyContent?.hasAttribute('inert')).toBe(false);

		await openHistoryDetail(/view details for fuel entry from Mar 9, 2026/i);
		expect(screen.getByRole('dialog', { name: 'Entry details' })).toBeTruthy();
		expect(historyContent?.hasAttribute('inert')).toBe(true);
		expect(historyContent?.getAttribute('aria-hidden')).toBe('true');
		expect(document.body.style.overflow).toBe('hidden');
		expect(document.documentElement.style.overflow).toBe('hidden');

		await fireEvent.click(screen.getByRole('button', { name: 'Close' }));
		await waitFor(() => {
			expect(screen.queryByRole('dialog', { name: 'Entry details' })).toBeNull();
		});

		expect(historyContent?.hasAttribute('inert')).toBe(false);
		expect(historyContent?.getAttribute('aria-hidden')).toBeNull();
		expect(document.body.style.overflow).toBe('');
		expect(document.documentElement.style.overflow).toBe('');
		expect((screen.getByRole('radio', { name: 'Fuel' }) as HTMLInputElement).checked).toBe(true);
		expect((screen.getByRole('radio', { name: 'All time' }) as HTMLInputElement).checked).toBe(
			true
		);
		expect(document.activeElement?.getAttribute('data-entry-key')).toBe('fuel-2');
		expect(scrollToMock).not.toHaveBeenCalled();
	});

	it('hands off from detail to the existing edit flow and restores focus after cancel', async () => {
		mockActiveVehicle = testVehicle;
		mockGetAllFuelLogs.mockResolvedValue({ data: [testFuelEntry], error: null });
		mockGetAllExpenses.mockResolvedValue({ data: [], error: null });

		render(HistoryPage);
		await settlePage();

		await openHistoryDetail(/view details for fuel entry from Mar 9, 2026/i);
		await fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
		flushSync();

		expect(screen.queryByRole('dialog', { name: 'Entry details' })).toBeNull();
		expect(screen.getByRole('heading', { name: 'Editing fuel entry' })).toBeTruthy();

		await fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
		await waitFor(() => {
			expect(screen.queryByRole('heading', { name: 'Editing fuel entry' })).toBeNull();
		});

		expect(document.activeElement?.getAttribute('data-entry-key')).toBe('fuel-2');
	});

	it('deletes from detail, updates the stat bar immediately, and focuses the next visible entry', async () => {
		mockActiveVehicle = testVehicle;
		mockGetAllFuelLogs.mockResolvedValue({ data: [testFuelEntry], error: null });
		mockGetAllExpenses.mockResolvedValue({ data: [testExpense], error: null });

		render(HistoryPage);
		await settlePage();

		expect(getStatValue('Total spend')).toBe('EUR 198.00');

		await openHistoryDetail(/view details for maintenance entry from Mar 10, 2026/i);
		await fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
		flushSync();
		expect(screen.getByText('Delete this entry? This cannot be undone.')).toBeTruthy();

		await fireEvent.click(
			screen.getByRole('button', {
				name: 'Confirm delete maintenance entry from Mar 10, 2026'
			})
		);
		await settlePage();

		expect(mockDeleteExpense).toHaveBeenCalledWith(testExpense.id);
		expect(screen.queryByRole('dialog', { name: 'Entry details' })).toBeNull();
		expect(screen.queryByRole('group', { name: /maintenance entry, Mar 10, 2026/i })).toBeNull();
		expect(getStatValue('Total spend')).toBe('EUR 78.00');
		expect(document.activeElement?.getAttribute('data-entry-key')).toBe('fuel-2');
	});

	it('keeps a failed detail-sheet delete visible inside the sheet alert region', async () => {
		mockActiveVehicle = testVehicle;
		mockGetAllFuelLogs.mockResolvedValue({ data: [testFuelEntry], error: null });
		mockGetAllExpenses.mockResolvedValue({ data: [], error: null });
		mockDeleteFuelLog.mockResolvedValue({
			data: undefined,
			error: { code: 'DELETE_FAILED', message: 'fail' }
		});

		render(HistoryPage);
		await settlePage();

		await openHistoryDetail(/view details for fuel entry from Mar 9, 2026/i);
		await fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
		await fireEvent.click(
			screen.getByRole('button', {
				name: 'Confirm delete fuel entry from Mar 9, 2026'
			})
		);
		await settlePage();

		const dialog = screen.getByRole('dialog', { name: 'Entry details' });
		expect(dialog).toBeTruthy();
		expect(within(dialog).getByText('Delete this entry? This cannot be undone.')).toBeTruthy();
		expect(within(dialog).getByRole('alert')).toBeTruthy();
		expect(within(dialog).getByText('Could not delete fuel entry. Please try again.')).toBeTruthy();

		await fireEvent.click(
			within(dialog).getByRole('button', {
				name: 'Cancel deleting fuel entry from Mar 9, 2026'
			})
		);
		flushSync();

		expect(screen.queryByText('Delete this entry? This cannot be undone.')).toBeNull();
		expect(screen.queryByText('Could not delete fuel entry. Please try again.')).toBeNull();
	});

	it('deletes a maintenance expense and removes it from history', async () => {
		mockActiveVehicle = testVehicle;
		mockGetAllFuelLogs.mockResolvedValue({ data: [], error: null });
		mockGetAllExpenses.mockResolvedValue({ data: [testExpense], error: null });

		render(HistoryPage);
		await settlePage();

		// Swipe to reveal
		const card = screen.getByRole('group', { name: /maintenance entry, Mar 10, 2026/i });
		await fireEvent.pointerDown(card, { pointerId: 1, clientX: 200, clientY: 16 });
		await fireEvent.pointerMove(card, { pointerId: 1, clientX: 120, clientY: 16 });
		await fireEvent.pointerUp(card, { pointerId: 1, clientX: 120, clientY: 16 });

		// Arm delete
		await fireEvent.click(
			screen.getByRole('button', { name: /delete maintenance entry from Mar 10, 2026/i })
		);
		flushSync();

		// Confirm delete
		await fireEvent.click(screen.getByRole('button', { name: /confirm delete/i }));
		await settlePage();

		expect(mockDeleteExpense).toHaveBeenCalledWith(testExpense.id);
		expect(screen.queryByRole('group', { name: /maintenance entry, Mar 10, 2026/i })).toBeNull();
	});

	it('displays the active vehicle from context and loads its entries', async () => {
		const anotherVehicle = {
			id: 3,
			name: 'Backup Car',
			make: 'Toyota',
			model: 'Corolla',
			year: 2019
		};
		mockActiveVehicle = anotherVehicle;
		mockGetAllFuelLogs.mockResolvedValue({ data: [], error: null });
		mockGetAllExpenses.mockResolvedValue({ data: [], error: null });

		render(HistoryPage);
		await settlePage();

		expect(screen.getAllByText(/Backup Car/i).length).toBeGreaterThanOrEqual(1);
		expect(mockGetAllFuelLogs).toHaveBeenCalledWith(3);
	});

	it('shows empty state with vehicle subtitle when vehicle exists but both repos return empty arrays', async () => {
		mockActiveVehicle = testVehicle;
		mockGetAllFuelLogs.mockResolvedValue({ data: [], error: null });
		mockGetAllExpenses.mockResolvedValue({ data: [], error: null });

		render(HistoryPage);
		await settlePage();

		expect(screen.getAllByText(/Old Faithful/i).length).toBeGreaterThanOrEqual(1);
		expect(screen.getByText('No entries yet for Old Faithful')).toBeTruthy();
		expect(screen.getByRole('link', { name: /go to fuel/i })).toBeTruthy();
		expect(getHistoryCards()).toHaveLength(0);
	});

	it('renders the All/Fuel/Maintenance filter and updates visible entries in place', async () => {
		mockActiveVehicle = testVehicle;
		mockGetAllFuelLogs.mockResolvedValue({ data: [testFuelEntry], error: null });
		mockGetAllExpenses.mockResolvedValue({ data: [testExpense], error: null });

		render(HistoryPage);
		await settlePage();

		const allRadio = screen.getByRole('radio', { name: 'All' }) as HTMLInputElement;
		const fuelRadio = screen.getByRole('radio', { name: 'Fuel' }) as HTMLInputElement;
		const maintenanceRadio = screen.getByRole('radio', {
			name: 'Maintenance'
		}) as HTMLInputElement;

		expect(allRadio.checked).toBe(true);
		expect(getHistoryCardKeys()).toEqual(['maintenance-5', 'fuel-2']);

		await fireEvent.click(fuelRadio);
		flushSync();

		expect(fuelRadio.checked).toBe(true);
		expect(getHistoryCardKeys()).toEqual(['fuel-2']);
		expect(screen.queryByText('Loading history...')).toBeNull();
		expect(mockGetAllFuelLogs).toHaveBeenCalledTimes(1);
		expect(mockGetAllExpenses).toHaveBeenCalledTimes(1);
		expect(scrollToMock).not.toHaveBeenCalled();

		await fireEvent.click(maintenanceRadio);
		flushSync();

		expect(maintenanceRadio.checked).toBe(true);
		expect(getHistoryCardKeys()).toEqual(['maintenance-5']);
		expect(screen.queryByText('Loading history...')).toBeNull();
		expect(sessionStorageMock.getItem(HISTORY_ENTRY_FILTER_STORAGE_KEY)).toBe('maintenance');
		expect(scrollToMock).not.toHaveBeenCalled();
	});

	it('shows a filter-specific empty state with a reset action when no entries match', async () => {
		mockActiveVehicle = testVehicle;
		mockGetAllFuelLogs.mockResolvedValue({ data: [testFuelEntry], error: null });
		mockGetAllExpenses.mockResolvedValue({ data: [], error: null });

		render(HistoryPage);
		await settlePage();

		expect(screen.getByRole('radio', { name: 'Maintenance' })).toBeTruthy();

		await fireEvent.click(screen.getByRole('radio', { name: 'Maintenance' }));
		flushSync();

		expect(screen.getByText('No maintenance entries for Old Faithful yet.')).toBeTruthy();
		expect(screen.queryByText(/No entries yet/)).toBeNull();
		expect(screen.getByRole('button', { name: 'Show all entries' })).toBeTruthy();
		expect(getHistoryCards()).toHaveLength(0);

		await fireEvent.click(screen.getByRole('button', { name: 'Show all entries' }));
		flushSync();

		expect((screen.getByRole('radio', { name: 'All' }) as HTMLInputElement).checked).toBe(true);
		expect(getHistoryCardKeys()).toEqual(['fuel-2']);
	});

	it('defaults to This month and switches stat-bar periods without reloading route data', async () => {
		setHistoryReferenceDate(new Date(2026, 2, 15, 12, 0, 0, 0));
		mockActiveVehicle = testVehicle;
		const earlierThisYearFuelEntry = {
			...testFuelEntry,
			id: 4,
			date: new Date(2026, 1, 25, 12, 0, 0, 0),
			quantity: 30,
			totalCost: 44,
			calculatedConsumption: 7.5
		};
		const currentMonthFuelEntry = {
			...testFuelEntry,
			date: new Date(2026, 2, 9, 12, 0, 0, 0)
		};
		const currentMonthExpense = {
			...testExpense,
			date: new Date(2026, 2, 10, 12, 0, 0, 0)
		};
		const previousYearExpense = {
			...testExpense,
			id: 8,
			date: new Date(2025, 2, 5, 12, 0, 0, 0),
			cost: 250
		};
		mockGetAllFuelLogs.mockResolvedValue({
			data: [currentMonthFuelEntry, earlierThisYearFuelEntry],
			error: null
		});
		mockGetAllExpenses.mockResolvedValue({
			data: [currentMonthExpense, previousYearExpense],
			error: null
		});

		render(HistoryPage);
		await settlePage();

		const thisMonthRadio = screen.getByRole('radio', { name: 'This month' }) as HTMLInputElement;
		const thisYearRadio = screen.getByRole('radio', { name: 'This year' }) as HTMLInputElement;
		const allTimeRadio = screen.getByRole('radio', { name: 'All time' }) as HTMLInputElement;

		expect(thisMonthRadio.checked).toBe(true);
		expect(
			screen.getByLabelText(`Total car costs for this month: ${formatCurrency(198)}`)
		).toBeTruthy();
		expect(getStatValue('Total spend')).toBe(formatCurrency(198));

		await fireEvent.click(thisYearRadio);
		flushSync();

		expect(thisYearRadio.checked).toBe(true);
		expect(
			screen.getByLabelText(`Total car costs for this year: ${formatCurrency(242)}`)
		).toBeTruthy();
		expect(getStatValue('Total spend')).toBe(formatCurrency(242));
		expect(screen.queryByText('Loading history...')).toBeNull();
		expect(mockGetAllFuelLogs).toHaveBeenCalledTimes(1);
		expect(mockGetAllExpenses).toHaveBeenCalledTimes(1);
		expect(scrollToMock).not.toHaveBeenCalled();

		await fireEvent.click(allTimeRadio);
		flushSync();

		expect(allTimeRadio.checked).toBe(true);
		expect(
			screen.getByLabelText(`Total car costs for all time: ${formatCurrency(492)}`)
		).toBeTruthy();
		expect(getStatValue('Total spend')).toBe(formatCurrency(492));
		expect(screen.queryByText('Loading history...')).toBeNull();
		expect(mockGetAllFuelLogs).toHaveBeenCalledTimes(1);
		expect(mockGetAllExpenses).toHaveBeenCalledTimes(1);
		expect(scrollToMock).not.toHaveBeenCalled();
	});

	it('keeps the history list stable while entry-type and time-period controls combine for stat-bar math', async () => {
		setHistoryReferenceDate(new Date(2026, 2, 15, 12, 0, 0, 0));
		mockActiveVehicle = testVehicle;
		const earlierThisYearFuelEntry = {
			...testFuelEntry,
			id: 4,
			date: new Date(2026, 1, 25, 12, 0, 0, 0),
			quantity: 30,
			totalCost: 44,
			calculatedConsumption: 7.5
		};
		const previousYearFuelEntry = {
			...testFuelEntry,
			id: 3,
			date: new Date(2025, 2, 12, 12, 0, 0, 0),
			quantity: 20,
			totalCost: 33,
			calculatedConsumption: 6.5
		};
		const currentMonthFuelEntry = {
			...testFuelEntry,
			date: new Date(2026, 2, 9, 12, 0, 0, 0)
		};
		const currentMonthExpense = {
			...testExpense,
			date: new Date(2026, 2, 10, 12, 0, 0, 0)
		};
		mockGetAllFuelLogs.mockResolvedValue({
			data: [currentMonthFuelEntry, earlierThisYearFuelEntry, previousYearFuelEntry],
			error: null
		});
		mockGetAllExpenses.mockResolvedValue({ data: [currentMonthExpense], error: null });

		render(HistoryPage);
		await settlePage();

		await fireEvent.click(screen.getByRole('radio', { name: 'Fuel' }));
		flushSync();

		const visibleMonthLabels = getVisibleMonthGroupLabels();
		const visibleCardKeys = getHistoryCardKeys();

		expect(visibleCardKeys).toEqual(['fuel-2', 'fuel-4', 'fuel-3']);
		expect(visibleMonthLabels).toContain(formatHistoryMonthLabel(previousYearFuelEntry.date));

		await fireEvent.click(screen.getByRole('radio', { name: 'This year' }));
		flushSync();

		expect(screen.getByLabelText(`Fuel costs for this year: ${formatCurrency(122)}`)).toBeTruthy();
		expect(getStatValue('Total spend')).toBe(formatCurrency(122));
		expect(getHistoryCardKeys()).toEqual(visibleCardKeys);
		expect(getVisibleMonthGroupLabels()).toEqual(visibleMonthLabels);
		expect(screen.queryByText('Loading history...')).toBeNull();
		expect(scrollToMock).not.toHaveBeenCalled();

		await fireEvent.click(screen.getByRole('radio', { name: 'All time' }));
		flushSync();

		expect(screen.getByLabelText(`Fuel costs for all time: ${formatCurrency(155)}`)).toBeTruthy();
		expect(getStatValue('Total spend')).toBe(formatCurrency(155));
		expect(getHistoryCardKeys()).toEqual(visibleCardKeys);
		expect(getVisibleMonthGroupLabels()).toEqual(visibleMonthLabels);
		expect(screen.queryByText('Loading history...')).toBeNull();
		expect(scrollToMock).not.toHaveBeenCalled();
	});

	it('recalculates the stat bar and month subtotals from the active entry-type filter', async () => {
		mockActiveVehicle = testVehicle;
		const olderFuelEntry = {
			...testFuelEntry,
			id: 4,
			date: createDateInRelativeMonth(-1, 25),
			quantity: 30,
			totalCost: 44
		};
		const currentMonthFuelEntry = {
			...testFuelEntry,
			date: createDateInRelativeMonth(0, 9)
		};
		const currentMonthExpense = {
			...testExpense,
			date: createDateInRelativeMonth(0, 10)
		};
		mockGetAllFuelLogs.mockResolvedValue({
			data: [currentMonthFuelEntry, olderFuelEntry],
			error: null
		});
		mockGetAllExpenses.mockResolvedValue({ data: [currentMonthExpense], error: null });

		render(HistoryPage);
		await settlePage();

		expect(screen.getByLabelText('Total car costs for this month: EUR 198.00')).toBeTruthy();
		expect(getStatValue('Total spend')).toBe('EUR 198.00');
		expect(getStatValue('Fuel volume')).toBe('42 L');
		expect(getStatValue('Avg consumption')).toBe('7.2 L/100km');
		expect(getMonthSubtotal(formatHistoryMonthLabel(currentMonthExpense.date))).toContain(
			'EUR 198.00'
		);
		expect(getMonthSubtotal(formatHistoryMonthLabel(olderFuelEntry.date))).toContain('EUR 44.00');

		await fireEvent.click(screen.getByRole('radio', { name: 'Fuel' }));
		flushSync();

		expect(screen.getByLabelText('Fuel costs for this month: EUR 78.00')).toBeTruthy();
		expect(getStatValue('Total spend')).toBe('EUR 78.00');
		expect(getStatValue('Fuel volume')).toBe('42 L');
		expect(getStatValue('Avg consumption')).toBe('7.2 L/100km');
		expect(getMonthSubtotal(formatHistoryMonthLabel(currentMonthExpense.date))).toContain(
			'EUR 78.00'
		);
		expect(getMonthSubtotal(formatHistoryMonthLabel(olderFuelEntry.date))).toContain('EUR 44.00');

		await fireEvent.click(screen.getByRole('radio', { name: 'Maintenance' }));
		flushSync();

		expect(screen.getByLabelText('Maintenance costs for this month: EUR 120.00')).toBeTruthy();
		expect(getStatValue('Total spend')).toBe('EUR 120.00');
		expect(getStatValue('Fuel volume')).toBe('0 L');
		expect(getStatValue('Avg consumption')).toBe('No data');
		expect(getMonthSubtotal(formatHistoryMonthLabel(currentMonthExpense.date))).toContain(
			'EUR 120.00'
		);
		expect(
			screen.queryByRole('heading', {
				name: formatHistoryMonthLabel(olderFuelEntry.date)
			})
		).toBeNull();
	});

	it('renders consumption labels in MPG when fuel-unit preference is MPG', async () => {
		mockSettingsFuelUnit = 'MPG';
		mockActiveVehicle = testVehicle;
		const currentMonthFuelEntry = {
			...testFuelEntry,
			date: createDateInRelativeMonth(0, 9)
		};
		mockGetAllFuelLogs.mockResolvedValue({ data: [currentMonthFuelEntry], error: null });
		mockGetAllExpenses.mockResolvedValue({ data: [], error: null });

		render(HistoryPage);
		await settlePage();

		expect(getStatValue('Fuel volume')).toMatch(/gal$/);
		expect(getStatValue('Avg consumption')).toMatch(/MPG$/);
		expect(getStatValue('Avg consumption')).not.toContain('L/100km');
	});

	it('shows a zero current-month hero while keeping older visible month groups when the active filter removes current-month entries', async () => {
		mockActiveVehicle = testVehicle;
		const previousMonthFuelEntry = {
			...testFuelEntry,
			id: 4,
			date: createDateInRelativeMonth(-1, 25),
			quantity: 30,
			totalCost: 44,
			calculatedConsumption: 7.5
		};
		const currentMonthExpense = {
			...testExpense,
			date: createDateInRelativeMonth(0, 10)
		};
		mockGetAllFuelLogs.mockResolvedValue({ data: [previousMonthFuelEntry], error: null });
		mockGetAllExpenses.mockResolvedValue({ data: [currentMonthExpense], error: null });

		render(HistoryPage);
		await settlePage();

		await fireEvent.click(screen.getByRole('radio', { name: 'Fuel' }));
		flushSync();

		expect(screen.getByLabelText('Fuel costs for this month: EUR 0.00')).toBeTruthy();
		expect(getStatValue('Total spend')).toBe('EUR 0.00');
		expect(getStatValue('Fuel volume')).toBe('0 L');
		expect(getStatValue('Avg consumption')).toBe('No data');
		expect(
			screen.queryByRole('heading', {
				name: formatHistoryMonthLabel(currentMonthExpense.date)
			})
		).toBeNull();
		expect(getMonthSubtotal(formatHistoryMonthLabel(previousMonthFuelEntry.date))).toContain(
			'EUR 44.00'
		);
	});

	it('refreshes the current-month hero when focus, pageshow, or visibilitychange returns after a month rollover', async () => {
		vi.useFakeTimers({ toFake: ['Date'] });
		const marchRolloverStart = new Date(2026, 2, 31, 23, 59, 30, 0);
		const aprilResumeDate = new Date(2026, 3, 1, 8, 0, 0, 0);
		const marchFuelEntry = {
			...testFuelEntry,
			date: new Date(2026, 2, 30, 12, 0, 0, 0)
		};
		const resumeEvents = [
			{
				name: 'focus',
				dispatch: () => window.dispatchEvent(new Event('focus'))
			},
			{
				name: 'pageshow',
				dispatch: () => window.dispatchEvent(new Event('pageshow'))
			},
			{
				name: 'visibilitychange',
				dispatch: () => {
					setDocumentVisibilityState('hidden');
					setDocumentVisibilityState('visible');
					document.dispatchEvent(new Event('visibilitychange'));
				}
			}
		];

		for (const resumeEvent of resumeEvents) {
			vi.setSystemTime(marchRolloverStart);
			mockActiveVehicle = testVehicle;
			mockGetAllFuelLogs.mockResolvedValue({ data: [marchFuelEntry], error: null });
			mockGetAllExpenses.mockResolvedValue({ data: [], error: null });

			const view = render(HistoryPage);
			await settlePage();

			expect(screen.getByLabelText('Total car costs for this month: EUR 78.00')).toBeTruthy();
			expect(getMonthSubtotal(formatHistoryMonthLabel(marchFuelEntry.date))).toContain('EUR 78.00');

			vi.setSystemTime(aprilResumeDate);
			resumeEvent.dispatch();
			flushSync();

			expect(
				screen.getByLabelText('Total car costs for this month: EUR 0.00'),
				`${resumeEvent.name} should refresh the current-month summary after rollover`
			).toBeTruthy();
			expect(getMonthSubtotal(formatHistoryMonthLabel(marchFuelEntry.date))).toContain('EUR 78.00');

			view.unmount();
			cleanup();
		}
	});

	it('restores the selected history filter from sessionStorage on remount within the same tab', async () => {
		mockActiveVehicle = testVehicle;
		mockGetAllFuelLogs.mockResolvedValue({ data: [testFuelEntry], error: null });
		mockGetAllExpenses.mockResolvedValue({ data: [testExpense], error: null });

		const firstRender = render(HistoryPage);
		await settlePage();

		await fireEvent.click(screen.getByRole('radio', { name: 'Fuel' }));
		flushSync();

		expect(sessionStorageMock.getItem(HISTORY_ENTRY_FILTER_STORAGE_KEY)).toBe('fuel');
		expect(getHistoryCardKeys()).toEqual(['fuel-2']);

		firstRender.unmount();

		render(HistoryPage);
		await settlePage();

		expect((screen.getByRole('radio', { name: 'Fuel' }) as HTMLInputElement).checked).toBe(true);
		expect(getHistoryCardKeys()).toEqual(['fuel-2']);
	});

	it('falls back to All and keeps filtering interactive when sessionStorage is blocked', async () => {
		mockActiveVehicle = testVehicle;
		mockGetAllFuelLogs.mockResolvedValue({ data: [testFuelEntry], error: null });
		mockGetAllExpenses.mockResolvedValue({ data: [testExpense], error: null });
		Object.defineProperty(globalThis, 'sessionStorage', {
			value: {
				getItem() {
					throw new Error('blocked');
				},
				setItem() {
					throw new Error('blocked');
				}
			},
			configurable: true,
			writable: true
		});

		render(HistoryPage);
		await settlePage();

		expect((screen.getByRole('radio', { name: 'All' }) as HTMLInputElement).checked).toBe(true);
		expect(getHistoryCardKeys()).toEqual(['maintenance-5', 'fuel-2']);

		await fireEvent.click(screen.getByRole('radio', { name: 'Fuel' }));
		flushSync();

		expect((screen.getByRole('radio', { name: 'Fuel' }) as HTMLInputElement).checked).toBe(true);
		expect(getHistoryCardKeys()).toEqual(['fuel-2']);
	});

	it('saving an edited fuel entry updates the history list and dismisses the inline form', async () => {
		mockActiveVehicle = testVehicle;
		mockGetAllFuelLogs.mockResolvedValue({ data: [testFuelEntry], error: null });
		mockGetAllExpenses.mockResolvedValue({ data: [], error: null });
		const updatedEntry = { ...testFuelEntry, totalCost: 99, calculatedConsumption: 8 };
		mockUpdateFuelLogsAtomic.mockResolvedValue({ data: [updatedEntry], error: null });

		render(HistoryPage);
		await settlePage();

		// Open edit via swipe (real timers for initial load)
		const card = screen.getByRole('group', { name: /fuel entry, Mar 9, 2026/i });
		await fireEvent.pointerDown(card, { pointerId: 1, clientX: 200, clientY: 16 });
		await fireEvent.pointerMove(card, { pointerId: 1, clientX: 120, clientY: 16 });
		await fireEvent.pointerUp(card, { pointerId: 1, clientX: 120, clientY: 16 });
		await fireEvent.click(
			screen.getByRole('button', { name: /edit fuel entry from Mar 9, 2026/i })
		);
		flushSync();
		expect(screen.getByRole('heading', { name: 'Editing fuel entry' })).toBeTruthy();

		// Switch to fake timers before save so the result-card dismiss timer is fakeable
		vi.useFakeTimers();
		await fireEvent.click(screen.getByRole('button', { name: /save changes/i }));
		await Promise.resolve();
		await Promise.resolve();
		flushSync();

		expect(mockUpdateFuelLogsAtomic).toHaveBeenCalledTimes(1);
		// History list reflects the updated entry (handleEditedFuelSaved wired correctly)
		expect(getHistoryCardKeys()).toContain('fuel-2');

		// Advance past RESULT_CARD_DISMISS_MS + 150ms fade — onSuccessFeedbackComplete fires and clears editingEntry
		await vi.advanceTimersByTimeAsync(RESULT_CARD_DISMISS_MS + 150);
		flushSync();
		expect(screen.queryByRole('heading', { name: 'Editing fuel entry' })).toBeNull();
	});

	it('saving an edited maintenance entry updates the history list and dismisses the inline form', async () => {
		mockActiveVehicle = testVehicle;
		mockGetAllFuelLogs.mockResolvedValue({ data: [], error: null });
		mockGetAllExpenses.mockResolvedValue({ data: [testExpense], error: null });
		const updatedExpense = { ...testExpense, cost: 150 };
		mockUpdateExpense.mockResolvedValue({ data: updatedExpense, error: null });

		render(HistoryPage);
		await settlePage();

		// Open edit via swipe (real timers for initial load)
		const card = screen.getByRole('group', { name: /maintenance entry, Mar 10, 2026/i });
		await fireEvent.pointerDown(card, { pointerId: 1, clientX: 200, clientY: 16 });
		await fireEvent.pointerMove(card, { pointerId: 1, clientX: 120, clientY: 16 });
		await fireEvent.pointerUp(card, { pointerId: 1, clientX: 120, clientY: 16 });
		await fireEvent.click(
			screen.getByRole('button', { name: /edit maintenance entry from Mar 10, 2026/i })
		);
		flushSync();
		expect(screen.getByRole('heading', { name: 'Editing maintenance entry' })).toBeTruthy();

		// Switch to fake timers before save so the result-card dismiss timer is fakeable
		vi.useFakeTimers();
		await fireEvent.click(screen.getByRole('button', { name: /save changes/i }));
		await Promise.resolve();
		await Promise.resolve();
		flushSync();

		expect(mockUpdateExpense).toHaveBeenCalledTimes(1);
		// History list reflects the updated entry (handleEditedMaintenanceSaved wired correctly)
		expect(getHistoryCardKeys()).toContain('maintenance-5');

		// Advance past RESULT_CARD_DISMISS_MS + 150ms fade — onSuccessFeedbackComplete fires and clears editingEntry
		await vi.advanceTimersByTimeAsync(RESULT_CARD_DISMISS_MS + 150);
		flushSync();
		expect(screen.queryByRole('heading', { name: 'Editing maintenance entry' })).toBeNull();
	});

	it('failed delete then cancel clears both inline confirmation and route error banner', async () => {
		mockActiveVehicle = testVehicle;
		mockGetAllFuelLogs.mockResolvedValue({ data: [testFuelEntry], error: null });
		mockGetAllExpenses.mockResolvedValue({ data: [], error: null });
		mockDeleteFuelLog.mockResolvedValue({
			data: undefined,
			error: { code: 'DELETE_FAILED', message: 'fail' }
		});

		render(HistoryPage);
		await settlePage();

		// Swipe to reveal
		const card = screen.getByRole('group', { name: /fuel entry, Mar 9, 2026/i });
		await fireEvent.pointerDown(card, { pointerId: 1, clientX: 200, clientY: 16 });
		await fireEvent.pointerMove(card, { pointerId: 1, clientX: 120, clientY: 16 });
		await fireEvent.pointerUp(card, { pointerId: 1, clientX: 120, clientY: 16 });

		// Arm delete
		await fireEvent.click(
			screen.getByRole('button', { name: /delete fuel entry from Mar 9, 2026/i })
		);
		flushSync();
		expect(screen.getByText('Delete this entry? This cannot be undone.')).toBeTruthy();

		// Confirm delete — repository returns error
		await fireEvent.click(screen.getByRole('button', { name: /confirm delete/i }));
		await settlePage();

		// Both the route-level error banner and the inline confirmation are visible
		expect(screen.getByRole('alert')).toBeTruthy();
		expect(screen.getByText(/could not delete fuel entry/i)).toBeTruthy();
		expect(screen.getByText('Delete this entry? This cannot be undone.')).toBeTruthy();

		// Cancel — handleDeleteCancel clears armedDeleteEntryKey and deleteErrorText
		await fireEvent.click(screen.getByRole('button', { name: /cancel deleting/i }));
		flushSync();

		expect(screen.queryByText('Delete this entry? This cannot be undone.')).toBeNull();
		expect(screen.queryByText(/could not delete fuel entry/i)).toBeNull();
		expect(screen.queryByRole('alert')).toBeNull();
	});

	it('keeps the delete error banner visible when the filter changes during a failed delete', async () => {
		mockActiveVehicle = testVehicle;
		mockGetAllFuelLogs.mockResolvedValue({ data: [testFuelEntry], error: null });
		mockGetAllExpenses.mockResolvedValue({ data: [testExpense], error: null });

		let resolveFuelDelete!: (value: {
			data: undefined;
			error: { code: 'DELETE_FAILED'; message: string };
		}) => void;
		mockDeleteFuelLog.mockReturnValue(
			new Promise((resolve) => {
				resolveFuelDelete = resolve;
			})
		);

		render(HistoryPage);
		await settlePage();

		await swipeLeft(screen.getByRole('group', { name: /fuel entry, Mar 9, 2026/i }));
		await fireEvent.click(
			screen.getByRole('button', { name: /delete fuel entry from Mar 9, 2026/i })
		);
		await fireEvent.click(
			screen.getByRole('button', { name: /confirm delete fuel entry from Mar 9, 2026/i })
		);
		flushSync();

		await fireEvent.click(screen.getByRole('radio', { name: 'Maintenance' }));
		flushSync();

		resolveFuelDelete({
			data: undefined,
			error: { code: 'DELETE_FAILED', message: 'boom' }
		});
		await settlePage();

		expect(screen.getByRole('alert')).toBeTruthy();
		expect(screen.getByText('Could not delete fuel entry. Please try again.')).toBeTruthy();
		expect(getHistoryCardKeys()).toEqual(['maintenance-5']);
		expect(screen.queryByText('Delete this entry? This cannot be undone.')).toBeNull();
	});

	it('refreshes the open fuel edit timeline after deleting a different fuel log', async () => {
		mockActiveVehicle = testVehicle;
		const firstLog = {
			...testFuelEntry,
			id: 1,
			date: new Date(2026, 2, 8, 12, 0, 0, 0),
			odometer: 100,
			quantity: 10,
			totalCost: 20,
			calculatedConsumption: 0
		};
		const deletedLog = {
			...testFuelEntry,
			id: 2,
			date: new Date(2026, 2, 9, 12, 0, 0, 0),
			odometer: 200,
			quantity: 10,
			totalCost: 20,
			calculatedConsumption: 10
		};
		const editedLog = {
			...testFuelEntry,
			id: 3,
			date: new Date(2026, 2, 10, 12, 0, 0, 0),
			odometer: 300,
			quantity: 10,
			totalCost: 20,
			calculatedConsumption: 10
		};
		const refreshedEditedLog = { ...editedLog, calculatedConsumption: 5 };
		const savedEditedLog = {
			...refreshedEditedLog,
			odometer: 150,
			calculatedConsumption: 20
		};
		let currentFuelLogs = [editedLog, deletedLog, firstLog];

		mockGetAllFuelLogs.mockImplementation(async () => ({
			data: [...currentFuelLogs],
			error: null
		}));
		mockGetAllExpenses.mockResolvedValue({ data: [], error: null });
		mockDeleteFuelLog.mockImplementation(async (id: number) => {
			expect(id).toBe(deletedLog.id);
			currentFuelLogs = [refreshedEditedLog, firstLog];
			return {
				data: {
					deletedLogId: deletedLog.id,
					updatedLogs: [refreshedEditedLog]
				},
				error: null
			};
		});
		mockUpdateFuelLogsAtomic.mockImplementation(async () => {
			currentFuelLogs = [savedEditedLog, firstLog];
			return {
				data: [savedEditedLog],
				error: null
			};
		});

		render(HistoryPage);
		await settlePage();

		await swipeLeft(screen.getByRole('group', { name: /fuel entry, Mar 10, 2026/i }));
		await fireEvent.click(
			screen.getByRole('button', { name: /edit fuel entry from Mar 10, 2026/i })
		);
		await settlePage();

		expect(screen.getByText('Last: 200 km')).toBeTruthy();

		await swipeLeft(screen.getByRole('group', { name: /fuel entry, Mar 9, 2026/i }), 2);
		await fireEvent.click(
			screen.getByRole('button', { name: /delete fuel entry from Mar 9, 2026/i })
		);
		await fireEvent.click(
			screen.getByRole('button', { name: /confirm delete fuel entry from Mar 9, 2026/i })
		);
		await settlePage();

		expect(screen.getByText('Last: 100 km')).toBeTruthy();

		await fireEvent.input(screen.getByLabelText(/odometer/i), {
			target: { value: '150' }
		});
		await fireEvent.click(screen.getByRole('button', { name: /save changes/i }));
		await settlePage();

		expect(mockUpdateFuelLogsAtomic).toHaveBeenCalledTimes(1);
		expect(screen.queryByText(/higher than the last logged value/i)).toBeNull();
	});

	it('moves focus to the next entry card after a successful delete', async () => {
		mockActiveVehicle = testVehicle;
		const newerEntry = { ...testExpense, id: 9, type: 'Insurance', cost: 120 };
		const olderEntry = {
			...testExpense,
			id: 8,
			date: new Date(2026, 2, 9, 12, 0, 0, 0),
			type: 'Tyres',
			cost: 250
		};

		mockGetAllFuelLogs.mockResolvedValue({ data: [], error: null });
		mockGetAllExpenses.mockResolvedValue({ data: [newerEntry, olderEntry], error: null });
		mockDeleteExpense.mockResolvedValue({ data: undefined, error: null });

		render(HistoryPage);
		await settlePage();

		await swipeLeft(screen.getByRole('group', { name: /maintenance entry, Mar 10, 2026/i }));
		await fireEvent.click(
			screen.getByRole('button', { name: /delete maintenance entry from Mar 10, 2026/i })
		);
		await fireEvent.click(
			screen.getByRole('button', { name: /confirm delete maintenance entry from Mar 10, 2026/i })
		);
		await settlePage();

		const remainingCard = screen.getByRole('group', {
			name: /maintenance entry, Mar 9, 2026, EUR 250\.00, Tyres/i
		});
		expect(document.activeElement).toBe(remainingCard);
	});

	it('falls back to a still-visible card when the filter changes during a pending delete', async () => {
		mockActiveVehicle = testVehicle;
		const olderFuelEntry = {
			...testFuelEntry,
			id: 4,
			date: new Date(2026, 1, 25, 12, 0, 0, 0),
			totalCost: 44
		};

		mockGetAllFuelLogs.mockResolvedValue({ data: [testFuelEntry, olderFuelEntry], error: null });
		mockGetAllExpenses.mockResolvedValue({ data: [testExpense], error: null });

		let resolveFuelDelete!: (value: {
			data: { deletedLogId: number; updatedLogs: [] };
			error: null;
		}) => void;
		mockDeleteFuelLog.mockReturnValue(
			new Promise((resolve) => {
				resolveFuelDelete = resolve;
			})
		);

		render(HistoryPage);
		await settlePage();

		await swipeLeft(screen.getByRole('group', { name: /fuel entry, Mar 9, 2026/i }));
		await fireEvent.click(
			screen.getByRole('button', { name: /delete fuel entry from Mar 9, 2026/i })
		);
		await fireEvent.click(
			screen.getByRole('button', { name: /confirm delete fuel entry from Mar 9, 2026/i })
		);
		flushSync();

		await fireEvent.click(screen.getByRole('radio', { name: 'Maintenance' }));
		flushSync();

		resolveFuelDelete({ data: { deletedLogId: testFuelEntry.id, updatedLogs: [] }, error: null });
		await settlePage();

		const visibleCard = screen.getByRole('group', {
			name: /maintenance entry, Mar 10, 2026, EUR 120\.00, Oil Change/i
		});
		expect(document.activeElement).toBe(visibleCard);
	});

	it('moves focus to the empty-state CTA when deleting the last remaining entry', async () => {
		mockActiveVehicle = testVehicle;
		const onlyEntry = { ...testExpense, id: 9, type: 'Insurance', cost: 120 };

		mockGetAllFuelLogs.mockResolvedValue({ data: [], error: null });
		mockGetAllExpenses.mockResolvedValue({ data: [onlyEntry], error: null });
		mockDeleteExpense.mockResolvedValue({ data: undefined, error: null });

		render(HistoryPage);
		await settlePage();

		await swipeLeft(screen.getByRole('group', { name: /maintenance entry, Mar 10, 2026/i }));
		await fireEvent.click(
			screen.getByRole('button', { name: /delete maintenance entry from Mar 10, 2026/i })
		);
		await fireEvent.click(
			screen.getByRole('button', { name: /confirm delete maintenance entry from Mar 10, 2026/i })
		);
		await settlePage();

		const emptyStateCta = screen.getByRole('link', { name: /go to fuel/i });
		expect(document.activeElement).toBe(emptyStateCta);
	});

	it('sibling Edit and Delete buttons are disabled while another deletion is actively in flight', async () => {
		mockActiveVehicle = testVehicle;
		mockGetAllFuelLogs.mockResolvedValue({ data: [testFuelEntry], error: null });
		mockGetAllExpenses.mockResolvedValue({ data: [testExpense], error: null });

		let resolveFuelDelete!: (value: {
			data: { deletedLogId: number; updatedLogs: [] };
			error: null;
		}) => void;
		mockDeleteFuelLog.mockReturnValue(
			new Promise((resolve) => {
				resolveFuelDelete = resolve;
			})
		);

		render(HistoryPage);
		await settlePage();

		// Swipe fuel entry and arm delete
		const fuelCard = screen.getByRole('group', { name: /fuel entry, Mar 9, 2026/i });
		await fireEvent.pointerDown(fuelCard, { pointerId: 1, clientX: 200, clientY: 16 });
		await fireEvent.pointerMove(fuelCard, { pointerId: 1, clientX: 120, clientY: 16 });
		await fireEvent.pointerUp(fuelCard, { pointerId: 1, clientX: 120, clientY: 16 });
		await fireEvent.click(
			screen.getByRole('button', { name: /delete fuel entry from Mar 9, 2026/i })
		);
		flushSync();

		// Confirm delete — deletingEntryKey = 'fuel-2' set synchronously before await
		await fireEvent.click(screen.getByRole('button', { name: /confirm delete/i }));
		flushSync();

		// Swipe the maintenance card to reveal its actions while fuel deletion is in-flight
		const maintCard = screen.getByRole('group', { name: /maintenance entry, Mar 10, 2026/i });
		await fireEvent.pointerDown(maintCard, { pointerId: 2, clientX: 200, clientY: 16 });
		await fireEvent.pointerMove(maintCard, { pointerId: 2, clientX: 120, clientY: 16 });
		await fireEvent.pointerUp(maintCard, { pointerId: 2, clientX: 120, clientY: 16 });

		const maintEditButton = screen.getByRole('button', {
			name: /edit maintenance entry from Mar 10, 2026/i
		});
		const maintDeleteButton = screen.getByRole('button', {
			name: /delete maintenance entry from Mar 10, 2026/i
		});
		expect((maintEditButton as HTMLButtonElement).disabled).toBe(true);
		expect((maintDeleteButton as HTMLButtonElement).disabled).toBe(true);

		// Resolve the pending deletion to allow cleanup
		resolveFuelDelete({ data: { deletedLogId: testFuelEntry.id, updatedLogs: [] }, error: null });
		await settlePage();
	});

	it('disables Edit buttons on other cards while an edit form is already open', async () => {
		const secondFuelEntry = {
			...testFuelEntry,
			id: 3,
			date: new Date(2026, 2, 8, 12, 0, 0, 0),
			odometer: 87000,
			totalCost: 65
		};
		mockActiveVehicle = testVehicle;
		mockGetAllFuelLogs.mockResolvedValue({
			data: [testFuelEntry, secondFuelEntry],
			error: null
		});
		mockGetAllExpenses.mockResolvedValue({ data: [testExpense], error: null });

		render(HistoryPage);
		await settlePage();

		// Swipe and open edit on the first fuel entry
		const firstCard = screen.getByRole('group', { name: /fuel entry, Mar 9, 2026/i });
		await swipeLeft(firstCard);
		await fireEvent.click(
			screen.getByRole('button', { name: /edit fuel entry from Mar 9, 2026/i })
		);
		flushSync();
		expect(screen.getByRole('heading', { name: 'Editing fuel entry' })).toBeTruthy();

		// Swipe the second fuel card to reveal actions
		const secondCard = screen.getByRole('group', { name: /fuel entry, Mar 8, 2026/i });
		await swipeLeft(secondCard, 2);

		// The Edit button on the second card should be disabled
		const secondEditButton = screen.getByRole('button', {
			name: /edit fuel entry from Mar 8, 2026/i
		});
		expect((secondEditButton as HTMLButtonElement).disabled).toBe(true);

		// The maintenance card's Edit button should also be disabled
		const maintCard = screen.getByRole('group', { name: /maintenance entry, Mar 10, 2026/i });
		await swipeLeft(maintCard, 3);
		const maintEditButton = screen.getByRole('button', {
			name: /edit maintenance entry from Mar 10, 2026/i
		});
		expect((maintEditButton as HTMLButtonElement).disabled).toBe(true);
	});

	it('includes vehicle name in filtered empty state title', async () => {
		mockActiveVehicle = testVehicle;
		mockGetAllFuelLogs.mockResolvedValue({ data: [testFuelEntry], error: null });
		mockGetAllExpenses.mockResolvedValue({ data: [], error: null });

		render(HistoryPage);
		await settlePage();

		await fireEvent.click(screen.getByRole('radio', { name: 'Maintenance' }));
		flushSync();

		expect(screen.getByText('No maintenance entries for Old Faithful yet.')).toBeTruthy();
	});

	it('includes vehicle name in fuel filtered empty state title', async () => {
		mockActiveVehicle = testVehicle;
		mockGetAllFuelLogs.mockResolvedValue({ data: [], error: null });
		mockGetAllExpenses.mockResolvedValue({ data: [testExpense], error: null });

		render(HistoryPage);
		await settlePage();

		await fireEvent.click(screen.getByRole('radio', { name: 'Fuel' }));
		flushSync();

		expect(screen.getByText('No fuel entries for Old Faithful yet.')).toBeTruthy();
	});

	it('shows vehicle-specific empty state when active vehicle has zero entries', async () => {
		mockActiveVehicle = testVehicle;
		mockGetAllFuelLogs.mockResolvedValue({ data: [], error: null });
		mockGetAllExpenses.mockResolvedValue({ data: [], error: null });

		render(HistoryPage);
		await settlePage();

		expect(screen.getByText('No entries yet for Old Faithful')).toBeTruthy();
		expect(
			screen.getByText(
				'Log a fuel fill-up or maintenance event for Old Faithful to get started.'
			)
		).toBeTruthy();
	});

	it('shows vehicle name in entry detail sheet', async () => {
		mockActiveVehicle = testVehicle;
		mockGetAllFuelLogs.mockResolvedValue({ data: [testFuelEntry], error: null });
		mockGetAllExpenses.mockResolvedValue({ data: [], error: null });

		render(HistoryPage);
		await settlePage();

		await openHistoryDetail(/view details for fuel entry from Mar 9, 2026/i);

		const dialog = screen.getByRole('dialog', { name: 'Entry details' });
		expect(within(dialog).getByText('Vehicle')).toBeTruthy();
		expect(within(dialog).getByText('Old Faithful')).toBeTruthy();
	});
});
