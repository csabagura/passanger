import { HISTORY_ENTRY_FILTER_STORAGE_KEY } from '$lib/config';
import type { HistoryEntryFilter } from '$lib/utils/historyEntries';

const SUPPORTED_HISTORY_ENTRY_FILTERS = ['all', 'fuel', 'maintenance'] as const;

export type HistoryEntryFilterStorage = HistoryEntryFilter;

function isHistoryEntryFilter(value: unknown): value is HistoryEntryFilter {
	return SUPPORTED_HISTORY_ENTRY_FILTERS.includes(value as HistoryEntryFilter);
}

function getSessionStorage(): Storage | null {
	try {
		return globalThis.sessionStorage;
	} catch {
		return null;
	}
}

export function readHistoryEntryFilter(): HistoryEntryFilter {
	const storage = getSessionStorage();
	if (!storage) {
		return 'all';
	}

	try {
		const storedValue = storage.getItem(HISTORY_ENTRY_FILTER_STORAGE_KEY);
		return isHistoryEntryFilter(storedValue) ? storedValue : 'all';
	} catch {
		return 'all';
	}
}

export function writeHistoryEntryFilter(filter: HistoryEntryFilter): void {
	const storage = getSessionStorage();
	if (!storage) {
		return;
	}

	try {
		storage.setItem(HISTORY_ENTRY_FILTER_STORAGE_KEY, filter);
	} catch {
		// sessionStorage blocked — ignore
	}
}
