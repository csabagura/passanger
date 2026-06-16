import { SETTINGS_STORAGE_KEY, DEFAULT_UNIT, DEFAULT_CURRENCY, SUPPORTED_UNITS } from '$lib/config';
import type { FuelUnit } from '$lib/config';

export type ThemePreference = 'system' | 'light' | 'dark';
const VALID_THEMES: readonly ThemePreference[] = ['system', 'light', 'dark'] as const;
const DEFAULT_THEME: ThemePreference = 'system';

export interface AppSettings {
	fuelUnit: FuelUnit;
	currency: string;
	theme: ThemePreference;
	// User-entered exchange rates, keyed by currency string. rate[c] = home-currency value of
	// 1 unit of currency c. Optional/absent for back-compat. Only finite > 0 entries are kept.
	exchangeRates?: Record<string, number>;
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

// Keep only entries whose rate is a finite number > 0; drop blanks/NaN/≤0. Returns
// undefined when nothing survives so the field stays absent (back-compat) rather than
// persisting an empty object.
function sanitizeExchangeRates(value: unknown): Record<string, number> | undefined {
	if (!value || typeof value !== 'object') {
		return undefined;
	}

	const sanitized: Record<string, number> = {};
	for (const [currency, rate] of Object.entries(value as Record<string, unknown>)) {
		if (typeof rate === 'number' && Number.isFinite(rate) && rate > 0) {
			sanitized[currency] = rate;
		}
	}

	return Object.keys(sanitized).length > 0 ? sanitized : undefined;
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
		const exchangeRates = sanitizeExchangeRates(persistedSettings.exchangeRates);

		const settings: AppSettings = {
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

		if (exchangeRates) {
			settings.exchangeRates = exchangeRates;
		}

		return settings;
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

	const exchangeRates = sanitizeExchangeRates(settings.exchangeRates);
	if (exchangeRates) {
		nextSettings.exchangeRates = exchangeRates;
	}

	try {
		localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(nextSettings));
		return true;
	} catch {
		// Silently handle QuotaExceededError and SecurityError so callers never crash
		return false;
	}
}
