import {
	SETTINGS_STORAGE_KEY,
	DEFAULT_UNIT,
	DEFAULT_CURRENCY,
	SUPPORTED_UNITS,
	HERO_METRICS
} from '$lib/config';
import type { FuelUnit, HeroMetric } from '$lib/config';
import { ok, err, type Result } from '$lib/utils/result';

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
	// Remembered Home Hero Metric choice (Story 3.4). Optional/absent for back-compat; absent or
	// invalid falls back to DEFAULT_HERO_METRIC ('cost') at the consumer, mirroring exchangeRates?.
	heroMetric?: HeroMetric;
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

function isValidHeroMetric(value: unknown): value is HeroMetric {
	return typeof value === 'string' && HERO_METRICS.includes(value as HeroMetric);
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

		// Optional/back-compat, exactly like exchangeRates: only attach when a valid value is
		// persisted; an absent or invalid field is left off so the consumer defaults to 'cost'.
		if (isValidHeroMetric(persistedSettings.heroMetric)) {
			settings.heroMetric = persistedSettings.heroMetric;
		}

		return settings;
	} catch {
		return { ...DEFAULT_SETTINGS };
	}
}

// S34: an exchangeRates map is "coerced" when the sanitized result drops or alters any entry the
// caller actually supplied (a non-finite/≤0 rate, or the whole map when nothing survives).
function exchangeRatesWereCoerced(
	input: unknown,
	sanitized: Record<string, number> | undefined
): boolean {
	if (!input || typeof input !== 'object') return false;
	const entries = Object.entries(input as Record<string, unknown>);
	if (entries.length === 0) return false;
	const sanitizedMap = sanitized ?? {};
	if (Object.keys(sanitizedMap).length !== entries.length) return true;
	return entries.some(([currency, rate]) => sanitizedMap[currency] !== rate);
}

/**
 * Persist settings, reporting which fields (if any) were silently substituted with a default or
 * dropped for invalid input (S34) — `ok({ coercedFields: [] })` means the input was written
 * verbatim. `err(...)` only on the actual localStorage write failing (unchanged from the prior
 * bare-boolean behavior's `false` case).
 */
export function saveSettings(settings: AppSettings): Result<{ coercedFields: string[] }> {
	if (typeof localStorage === 'undefined') {
		return err('SAVE_FAILED', 'localStorage unavailable');
	}

	const coercedFields: string[] = [];

	const fuelUnitValid = isValidFuelUnit(settings.fuelUnit);
	if (!fuelUnitValid) coercedFields.push('fuelUnit');
	const currencyValid = isValidCurrency(settings.currency);
	if (!currencyValid) coercedFields.push('currency');
	const themeValid = isValidTheme(settings.theme);
	if (!themeValid) coercedFields.push('theme');

	const nextSettings: AppSettings = {
		fuelUnit: fuelUnitValid ? settings.fuelUnit : DEFAULT_SETTINGS.fuelUnit,
		currency: currencyValid ? settings.currency : DEFAULT_SETTINGS.currency,
		theme: themeValid ? settings.theme : DEFAULT_SETTINGS.theme
	};

	const exchangeRates = sanitizeExchangeRates(settings.exchangeRates);
	if (exchangeRatesWereCoerced(settings.exchangeRates, exchangeRates)) {
		coercedFields.push('exchangeRates');
	}
	if (exchangeRates) {
		nextSettings.exchangeRates = exchangeRates;
	}

	// saveSettings reconstructs nextSettings from known fields only, so heroMetric must be
	// re-attached here or it is silently dropped. Persist only a valid value (mirrors exchangeRates).
	if (settings.heroMetric !== undefined) {
		if (isValidHeroMetric(settings.heroMetric)) {
			nextSettings.heroMetric = settings.heroMetric;
		} else {
			coercedFields.push('heroMetric');
		}
	}

	try {
		localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(nextSettings));
		return ok({ coercedFields });
	} catch {
		// Silently handle QuotaExceededError and SecurityError so callers never crash
		return err('SAVE_FAILED', 'Could not save settings');
	}
}
