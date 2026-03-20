import { SETTINGS_STORAGE_KEY, DEFAULT_UNIT, DEFAULT_CURRENCY, SUPPORTED_UNITS } from '$lib/config';
import type { FuelUnit } from '$lib/config';

export type ThemePreference = 'system' | 'light' | 'dark';
const VALID_THEMES: readonly ThemePreference[] = ['system', 'light', 'dark'] as const;
const DEFAULT_THEME: ThemePreference = 'system';

export interface AppSettings {
	fuelUnit: FuelUnit;
	currency: string;
	theme: ThemePreference;
}

const DEFAULT_SETTINGS: AppSettings = {
	fuelUnit: DEFAULT_UNIT,
	currency: DEFAULT_CURRENCY,
	theme: DEFAULT_THEME
};

function isValidFuelUnit(value: unknown): value is FuelUnit {
	return SUPPORTED_UNITS.includes(value as FuelUnit);
}

function isValidCurrency(value: unknown): value is string {
	return typeof value === 'string' && value.trim().length > 0;
}

function isValidTheme(value: unknown): value is ThemePreference {
	return typeof value === 'string' && VALID_THEMES.includes(value as ThemePreference);
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
				: DEFAULT_SETTINGS.currency,
			theme: isValidTheme(persistedSettings.theme)
				? persistedSettings.theme
				: DEFAULT_SETTINGS.theme
		};
	} catch {
		return { ...DEFAULT_SETTINGS };
	}
}

export function saveSettings(settings: AppSettings): boolean {
	if (typeof localStorage === 'undefined') return false;

	const nextSettings: AppSettings = {
		fuelUnit: isValidFuelUnit(settings.fuelUnit) ? settings.fuelUnit : DEFAULT_SETTINGS.fuelUnit,
		currency: isValidCurrency(settings.currency) ? settings.currency : DEFAULT_SETTINGS.currency,
		theme: isValidTheme(settings.theme) ? settings.theme : DEFAULT_SETTINGS.theme
	};

	try {
		localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(nextSettings));
		return true;
	} catch {
		// Silently handle QuotaExceededError and SecurityError so callers never crash
		return false;
	}
}
