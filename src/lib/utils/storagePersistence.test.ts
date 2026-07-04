import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
	requestStoragePersistence,
	hasNoticeDismissed,
	markNoticeDismissed,
	clearSessionStoragePersistenceOutcome
} from './storagePersistence';
import { STORAGE_PERSISTENCE_OUTCOME_KEY } from '$lib/config';

// ---------------------------------------------------------------------------
// localStorage mock (localStorage is not available in Node jsdom without setup)
// ---------------------------------------------------------------------------
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

// ---------------------------------------------------------------------------
// navigator.storage mock helpers
// ---------------------------------------------------------------------------
const mockPersisted = vi.fn<() => Promise<boolean>>();
const mockPersist = vi.fn<() => Promise<boolean>>();

function setNavigatorStorage(
	storage: { persisted: typeof mockPersisted; persist: typeof mockPersist } | undefined
) {
	Object.defineProperty(globalThis.navigator, 'storage', {
		value: storage,
		configurable: true,
		writable: true
	});
}

beforeEach(() => {
	localStorageMock.clear();
	// S18: denied/unavailable outcomes are cached in sessionStorage — jsdom's real sessionStorage
	// persists across tests in the same file unless cleared.
	sessionStorage.clear();
	vi.clearAllMocks();
	// Default: normal storage API present
	setNavigatorStorage({ persisted: mockPersisted, persist: mockPersist });
});

afterEach(() => {
	// Restore storage to a benign state
	setNavigatorStorage({ persisted: mockPersisted, persist: mockPersist });
});

// ---------------------------------------------------------------------------
// requestStoragePersistence
// ---------------------------------------------------------------------------

describe('requestStoragePersistence — already-persisted path', () => {
	it('returns "granted" when persisted() resolves true without calling persist()', async () => {
		mockPersisted.mockResolvedValue(true);

		const result = await requestStoragePersistence();

		expect(result).toBe('granted');
		expect(mockPersist).not.toHaveBeenCalled();
	});

	it('stores "granted" in localStorage when already persisted', async () => {
		mockPersisted.mockResolvedValue(true);
		await requestStoragePersistence();

		// Second call should also return 'granted' (reads persisted() again)
		mockPersisted.mockResolvedValue(true);
		const result2 = await requestStoragePersistence();
		expect(result2).toBe('granted');
	});
});

describe('requestStoragePersistence — first-request path (no stored outcome)', () => {
	it('returns "granted" when persist() resolves true', async () => {
		mockPersisted.mockResolvedValue(false);
		mockPersist.mockResolvedValue(true);

		const result = await requestStoragePersistence();

		expect(result).toBe('granted');
		expect(mockPersist).toHaveBeenCalledOnce();
	});

	it('returns "denied" when persist() resolves false', async () => {
		mockPersisted.mockResolvedValue(false);
		mockPersist.mockResolvedValue(false);

		const result = await requestStoragePersistence();

		expect(result).toBe('denied');
		expect(mockPersist).toHaveBeenCalledOnce();
	});

	it('stores the outcome in localStorage after first request', async () => {
		mockPersisted.mockResolvedValue(false);
		mockPersist.mockResolvedValue(false);

		await requestStoragePersistence();

		// Second call: origin still not persisted, but stored outcome should be returned
		mockPersisted.mockResolvedValue(false);
		const result2 = await requestStoragePersistence();

		expect(result2).toBe('denied');
		// persist() should only have been called once total (first request stored result)
		expect(mockPersist).toHaveBeenCalledOnce();
	});
});

describe('requestStoragePersistence — stored outcome path (skip re-requesting)', () => {
	it('returns stored "denied" outcome without calling persist() again', async () => {
		// First request — stores 'denied'
		mockPersisted.mockResolvedValue(false);
		mockPersist.mockResolvedValue(false);
		await requestStoragePersistence();

		vi.clearAllMocks();
		mockPersisted.mockResolvedValue(false);

		// Second call — should use stored outcome
		const result = await requestStoragePersistence();
		expect(result).toBe('denied');
		expect(mockPersist).not.toHaveBeenCalled();
	});
});

describe('requestStoragePersistence — unsupported browser paths', () => {
	it('returns "unavailable" when navigator.storage is undefined', async () => {
		setNavigatorStorage(undefined);

		const result = await requestStoragePersistence();

		expect(result).toBe('unavailable');
	});

	it('returns "unavailable" when persisted() throws', async () => {
		mockPersisted.mockRejectedValue(new TypeError('storage unavailable'));
		mockPersist.mockResolvedValue(false);

		const result = await requestStoragePersistence();

		expect(result).toBe('unavailable');
	});

	it('returns "unavailable" when persist() throws', async () => {
		mockPersisted.mockResolvedValue(false);
		mockPersist.mockRejectedValue(new TypeError('storage unavailable'));

		const result = await requestStoragePersistence();

		expect(result).toBe('unavailable');
	});

	it('does not throw or crash for any browser-API failure', async () => {
		setNavigatorStorage(undefined);

		await expect(requestStoragePersistence()).resolves.toBeDefined();
	});
});

describe('S18: denied/unavailable outcomes re-request per session, granted stays permanent', () => {
	it('caches "denied" in sessionStorage (not localStorage)', async () => {
		mockPersisted.mockResolvedValue(false);
		mockPersist.mockResolvedValue(false);
		await requestStoragePersistence();

		expect(sessionStorage.getItem(STORAGE_PERSISTENCE_OUTCOME_KEY)).toBe('denied');
		expect(localStorageMock.getItem(STORAGE_PERSISTENCE_OUTCOME_KEY)).toBeNull();
	});

	it('caches "granted" in localStorage (permanent — never re-asked)', async () => {
		mockPersisted.mockResolvedValue(false);
		mockPersist.mockResolvedValue(true);
		await requestStoragePersistence();

		expect(localStorageMock.getItem(STORAGE_PERSISTENCE_OUTCOME_KEY)).toBe('granted');
	});

	it('a fresh session (sessionStorage cleared, localStorage untouched) re-attempts persist() after a prior denial', async () => {
		mockPersisted.mockResolvedValue(false);
		mockPersist.mockResolvedValue(false);
		await requestStoragePersistence();
		expect(mockPersist).toHaveBeenCalledOnce();

		// Simulate a new browser session: sessionStorage clears, localStorage (no 'granted') persists.
		sessionStorage.clear();
		vi.clearAllMocks();
		mockPersisted.mockResolvedValue(false);
		mockPersist.mockResolvedValue(false);

		await requestStoragePersistence();
		expect(mockPersist).toHaveBeenCalledOnce();
	});

	it('clearSessionStoragePersistenceOutcome() removes only the session-cached outcome', async () => {
		mockPersisted.mockResolvedValue(false);
		mockPersist.mockResolvedValue(false);
		await requestStoragePersistence();
		expect(sessionStorage.getItem(STORAGE_PERSISTENCE_OUTCOME_KEY)).toBe('denied');

		clearSessionStoragePersistenceOutcome();
		expect(sessionStorage.getItem(STORAGE_PERSISTENCE_OUTCOME_KEY)).toBeNull();

		vi.clearAllMocks();
		mockPersisted.mockResolvedValue(false);
		mockPersist.mockResolvedValue(false);
		await requestStoragePersistence();
		expect(mockPersist).toHaveBeenCalledOnce();
	});
});

// ---------------------------------------------------------------------------
// Notice dismissal helpers
// ---------------------------------------------------------------------------

describe('hasNoticeDismissed / markNoticeDismissed', () => {
	it('hasNoticeDismissed returns false by default (no localStorage entry)', () => {
		expect(hasNoticeDismissed()).toBe(false);
	});

	it('hasNoticeDismissed returns true after markNoticeDismissed is called', () => {
		markNoticeDismissed();
		expect(hasNoticeDismissed()).toBe(true);
	});

	it('hasNoticeDismissed remains false if localStorage is cleared', () => {
		markNoticeDismissed();
		localStorageMock.clear();
		expect(hasNoticeDismissed()).toBe(false);
	});

	it('markNoticeDismissed is idempotent (safe to call multiple times)', () => {
		expect(() => {
			markNoticeDismissed();
			markNoticeDismissed();
		}).not.toThrow();
		expect(hasNoticeDismissed()).toBe(true);
	});
});
