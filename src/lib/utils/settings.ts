import { SETTINGS_STORAGE_KEY, DEFAULT_UNIT, DEFAULT_CURRENCY, SUPPORTED_UNITS } from '$lib/config';
import type { FuelUnit } from '$lib/config';

export interface AppSettings {
	fuelUnit: FuelUnit;
	currency: string;
}

const DEFAULT_SETTINGS: AppSettings = {
	fuelUnit: DEFAULT_UNIT,
	currency: DEFAULT_CURRENCY
};

function isValidFuelUnit(value: unknown): value is FuelUnit {
	return SUPPORTED_UNITS.includes(value as FuelUnit);
}

function isValidCurrency(value: unknown): value is string {
	return typeof value === 'string' && value.trim().length > 0;
}

export function getSettings(): AppSettings {
	if (typeof localStorage === 'undefined') {
		return { ...DEFAULT_SETTINGS };
	}

	try {
		const raw = localStorage.getItem(SETTINGS_STORAGE_KEY);
		if (!raw) return { ...DEFAULT_SETTINGS };
		const parsed = JSON.parse(raw) as unknown;
		if (!parsed || typeof parsed !== 'object') {
			return { ...DEFAULT_SETTINGS };
		}

		const persistedSettings = parsed as Record<string, unknown>;

		return {
			fuelUnit: isValidFuelUnit(persistedSettings.fuelUnit)
				? persistedSettings.fuelUnit
				: DEFAULT_SETTINGS.fuelUnit,
			currency: isValidCurrency(persistedSettings.currency)
				? persistedSettings.currency
				: DEFAULT_SETTINGS.currency
		};
	} catch {
		return { ...DEFAULT_SETTINGS };
	}
}

export function saveSettings(settings: AppSettings): boolean {
	if (typeof localStorage === 'undefined') return false;

	const nextSettings: AppSettings = {
		fuelUnit: isValidFuelUnit(settings.fuelUnit) ? settings.fuelUnit : DEFAULT_SETTINGS.fuelUnit,
		currency: isValidCurrency(settings.currency) ? settings.currency : DEFAULT_SETTINGS.currency
	};

	try {
		localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(nextSettings));
		return true;
	} catch {
		// Silently handle QuotaExceededError and SecurityError so callers never crash
		return false;
	}
}
