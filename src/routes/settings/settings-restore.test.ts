import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import type { AppSettings } from '$lib/utils/settings';
import { SETTINGS_RESTORE_COERCED_NOTICE_KEY, SETTINGS_STORAGE_KEY } from '$lib/config';
import SettingsPage from './+page.svelte';

const mockRestoreAllTables = vi.fn();
const mockExportAllTables = vi.fn();
const mockParseBackup = vi.fn();
const mockNotifyTabsRestored = vi.fn();
const mockNotifySettingsChanged = vi.fn();
const mockMarkRestorePending = vi.fn();

vi.mock('$lib/db/backup', () => ({
	restoreAllTables: (...args: unknown[]) => mockRestoreAllTables(...args),
	exportAllTables: () => mockExportAllTables()
}));

vi.mock('$lib/utils/backup', () => ({
	parseBackup: (...args: unknown[]) => mockParseBackup(...args),
	serializeBackup: vi.fn(),
	downloadBackupFile: vi.fn(),
	buildBackupFilename: vi.fn()
}));

vi.mock('$lib/utils/tabSync', () => ({
	notifyTabsRestored: () => mockNotifyTabsRestored(),
	notifySettingsChanged: () => mockNotifySettingsChanged()
}));

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
Object.defineProperty(globalThis, 'localStorage', { value: localStorageMock, writable: true });

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
Object.defineProperty(globalThis, 'sessionStorage', { value: sessionStorageMock, writable: true });

const reloadSpy = vi.fn();
Object.defineProperty(window, 'location', {
	value: { reload: reloadSpy },
	writable: true
});

function renderPage() {
	const settingsContext = {
		get settings() {
			return { fuelUnit: 'L/100km', currency: '€', theme: 'system' } as AppSettings;
		},
		updateSettings: vi.fn()
	};
	const vehiclesContext = {
		vehicles: [],
		activeVehicle: null,
		activeVehicleId: null,
		loaded: true,
		vehiclesError: false,
		switchVehicle: vi.fn(),
		refreshVehicles: vi.fn().mockResolvedValue(undefined)
	};
	const tabSyncContext = {
		markRestorePending: mockMarkRestorePending
	};

	return render(SettingsPage, {
		context: new Map<string, unknown>([
			['settings', settingsContext],
			['vehicles', vehiclesContext],
			['tabSync', tabSyncContext]
		])
	});
}

async function triggerRestoreConfirm() {
	const file = new File(['{}'], 'backup.json', { type: 'application/json' });
	const input = screen.getByLabelText(/restore from a backup/i) as HTMLInputElement;
	await fireEvent.change(input, { target: { files: [file] } });
	await waitFor(() => screen.getByRole('alertdialog'));
	await fireEvent.click(screen.getByRole('button', { name: /replace all/i }));
}

beforeEach(() => {
	vi.clearAllMocks();
	localStorageMock.clear();
	sessionStorageMock.clear();
	mockParseBackup.mockReturnValue({
		data: { data: {}, settings: { fuelUnit: 'L/100km', currency: '€', theme: 'system' } },
		error: null
	});
	mockRestoreAllTables.mockResolvedValue({ data: {}, error: null });
});

afterEach(() => {
	cleanup();
});

describe('S30: origin-tab reload latch on a failed restore-settings write', () => {
	it('arms the shared restorePending flag when saveSettings fails after a successful data restore', async () => {
		const realSetItem = localStorageMock.setItem;
		const setItemSpy = vi
			.spyOn(localStorageMock, 'setItem')
			.mockImplementation((key: string, value: string) => {
				if (key === SETTINGS_STORAGE_KEY) {
					throw new DOMException('SecurityError', 'SecurityError');
				}
				realSetItem(key, value);
			});

		renderPage();
		await triggerRestoreConfirm();

		await waitFor(() => {
			expect(mockMarkRestorePending).toHaveBeenCalledOnce();
		});
		expect(mockNotifyTabsRestored).toHaveBeenCalledOnce();
		expect(reloadSpy).not.toHaveBeenCalled();

		setItemSpy.mockRestore();
	});

	it('does NOT arm restorePending when the settings write succeeds (the tab reloads instead)', async () => {
		renderPage();
		await triggerRestoreConfirm();

		await waitFor(() => {
			expect(reloadSpy).toHaveBeenCalledOnce();
		});
		expect(mockMarkRestorePending).not.toHaveBeenCalled();
	});
});

describe('S34: restore surfaces a coercion notice for invalid restored settings', () => {
	it('stashes a show-once notice when the restored settings needed coercion, shown after reload', async () => {
		mockParseBackup.mockReturnValue({
			data: {
				data: {},
				settings: { fuelUnit: 'bogus', currency: '€', theme: 'system' } as unknown as AppSettings
			},
			error: null
		});

		renderPage();
		await triggerRestoreConfirm();

		await waitFor(() => {
			expect(reloadSpy).toHaveBeenCalledOnce();
		});
		expect(sessionStorageMock.getItem(SETTINGS_RESTORE_COERCED_NOTICE_KEY)).toBe('true');
	});

	it('does not stash a coercion notice when the restored settings were entirely valid', async () => {
		renderPage();
		await triggerRestoreConfirm();

		await waitFor(() => {
			expect(reloadSpy).toHaveBeenCalledOnce();
		});
		expect(sessionStorageMock.getItem(SETTINGS_RESTORE_COERCED_NOTICE_KEY)).toBeNull();
	});

	it('shows and consumes the coercion notice once on the next mount', async () => {
		sessionStorageMock.setItem(SETTINGS_RESTORE_COERCED_NOTICE_KEY, 'true');

		renderPage();

		await waitFor(() => {
			expect(screen.getByRole('status').textContent).toContain('reset to defaults');
		});
		expect(sessionStorageMock.getItem(SETTINGS_RESTORE_COERCED_NOTICE_KEY)).toBeNull();
	});
});
