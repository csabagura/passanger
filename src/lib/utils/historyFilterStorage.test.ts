import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HISTORY_ENTRY_FILTER_STORAGE_KEY } from '$lib/config';
import {
	readHistoryEntryFilter,
	writeHistoryEntryFilter,
	type HistoryEntryFilterStorage
} from './historyFilterStorage';

function createSessionStorageMock(initialState: Record<string, string> = {}): Storage {
	let store = { ...initialState };

	return {
		get length() {
			return Object.keys(store).length;
		},
		clear() {
			store = {};
		},
		getItem(key: string) {
			return store[key] ?? null;
		},
		key(index: number) {
			return Object.keys(store)[index] ?? null;
		},
		removeItem(key: string) {
			delete store[key];
		},
		setItem(key: string, value: string) {
			store[key] = value;
		}
	};
}

describe('historyFilterStorage', () => {
	beforeEach(() => {
		Object.defineProperty(globalThis, 'sessionStorage', {
			value: createSessionStorageMock(),
			configurable: true,
			writable: true
		});
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it('round-trips valid history filters through sessionStorage', () => {
		const supportedFilters: HistoryEntryFilterStorage[] = ['all', 'fuel', 'maintenance'];

		for (const filter of supportedFilters) {
			writeHistoryEntryFilter(filter);
			expect(readHistoryEntryFilter()).toBe(filter);
			globalThis.sessionStorage.removeItem(HISTORY_ENTRY_FILTER_STORAGE_KEY);
		}
	});

	it('falls back to all when sessionStorage contains an invalid value', () => {
		globalThis.sessionStorage.setItem(HISTORY_ENTRY_FILTER_STORAGE_KEY, 'diesel-only');

		expect(readHistoryEntryFilter()).toBe('all');
	});

	it('falls back to all and never throws when sessionStorage access is blocked', () => {
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

		expect(readHistoryEntryFilter()).toBe('all');
		expect(() => writeHistoryEntryFilter('fuel')).not.toThrow();
	});
});
