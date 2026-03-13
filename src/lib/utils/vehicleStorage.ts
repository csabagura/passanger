import { VEHICLE_ID_STORAGE_KEY } from '$lib/config';

function safeGetItem(key: string): string | null {
	try {
		return localStorage.getItem(key);
	} catch {
		return null;
	}
}

export function safeSetItem(key: string, value: string): void {
	try {
		localStorage.setItem(key, value);
	} catch {
		// localStorage blocked — ignore
	}
}

export function safeRemoveItem(key: string): void {
	try {
		localStorage.removeItem(key);
	} catch {
		// localStorage blocked — ignore
	}
}

export function readStoredVehicleId(): number | null {
	const raw = safeGetItem(VEHICLE_ID_STORAGE_KEY);
	if (!raw) {
		return null;
	}

	const trimmed = raw.trim();
	if (!/^\d+$/.test(trimmed)) {
		safeRemoveItem(VEHICLE_ID_STORAGE_KEY);
		return null;
	}

	const parsed = Number.parseInt(trimmed, 10);
	if (parsed <= 0) {
		safeRemoveItem(VEHICLE_ID_STORAGE_KEY);
		return null;
	}

	return parsed;
}
