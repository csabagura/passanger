import { describe, it, expect, beforeEach, vi } from 'vitest';
import { getSettings, saveSettings, type AppSettings } from './settings';
import { DEFAULT_UNIT, DEFAULT_CURRENCY, SETTINGS_STORAGE_KEY } from '$lib/config';

beforeEach(() => {
	localStorage.clear();
});

describe('Settings utility', () => {
	describe('getSettings()', () => {
		it('returns defaults when localStorage is empty', () => {
			const settings = getSettings();
			expect(settings.fuelUnit).toBe(DEFAULT_UNIT);
			expect(settings.currency).toBe(DEFAULT_CURRENCY);
		});

		it('returns stored fuelUnit', () => {
			saveSettings({ fuelUnit: 'MPG', currency: DEFAULT_CURRENCY, theme: 'system' });
			const settings = getSettings();
			expect(settings.fuelUnit).toBe('MPG');
		});

		it('returns stored currency', () => {
			saveSettings({ fuelUnit: DEFAULT_UNIT, currency: '$', theme: 'system' });
			const settings = getSettings();
			expect(settings.currency).toBe('$');
		});

		it('returns a stored custom currency prefix', () => {
			saveSettings({ fuelUnit: DEFAULT_UNIT, currency: 'EUR ', theme: 'system' });
			const settings = getSettings();
			expect(settings.currency).toBe('EUR ');
		});

		it('returns full stored settings object', () => {
			saveSettings({ fuelUnit: 'MPG', currency: '£', theme: 'system' });
			const settings = getSettings();
			expect(settings).toEqual({ fuelUnit: 'MPG', currency: '£', theme: 'system' });
		});

		it('falls back to defaults when stored JSON is invalid', () => {
			localStorage.setItem(SETTINGS_STORAGE_KEY, 'not-valid-json{{{');
			const settings = getSettings();
			expect(settings.fuelUnit).toBe(DEFAULT_UNIT);
			expect(settings.currency).toBe(DEFAULT_CURRENCY);
		});

		it('merges partial stored data with defaults', () => {
			localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify({ fuelUnit: 'MPG' }));
			const settings = getSettings();
			expect(settings.fuelUnit).toBe('MPG');
			expect(settings.currency).toBe(DEFAULT_CURRENCY); // default applied
		});

		it('falls back to default fuelUnit when stored value is not a valid enum', () => {
			localStorage.setItem(
				SETTINGS_STORAGE_KEY,
				JSON.stringify({ fuelUnit: 'km/l', currency: '€' })
			);
			const settings = getSettings();
			expect(settings.fuelUnit).toBe(DEFAULT_UNIT);
			expect(settings.currency).toBe('€');
		});

		it('falls back to default currency when stored value is blank', () => {
			localStorage.setItem(
				SETTINGS_STORAGE_KEY,
				JSON.stringify({ fuelUnit: 'MPG', currency: '   ' })
			);
			const settings = getSettings();
			expect(settings.fuelUnit).toBe('MPG');
			expect(settings.currency).toBe(DEFAULT_CURRENCY);
		});

		it('falls back to default currency when stored value is not a string', () => {
			localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify({ fuelUnit: 'MPG', currency: 42 }));
			const settings = getSettings();
			expect(settings.fuelUnit).toBe('MPG');
			expect(settings.currency).toBe(DEFAULT_CURRENCY);
		});

		it('falls back to all defaults when both persisted values are invalid', () => {
			localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify({ fuelUnit: 'foo', currency: '' }));
			const settings = getSettings();
			expect(settings.fuelUnit).toBe(DEFAULT_UNIT);
			expect(settings.currency).toBe(DEFAULT_CURRENCY);
		});

		it('returns theme: system as default when localStorage is empty', () => {
			const settings = getSettings();
			expect(settings.theme).toBe('system');
		});

		it('returns stored theme value', () => {
			saveSettings({ fuelUnit: DEFAULT_UNIT, currency: DEFAULT_CURRENCY, theme: 'dark' });
			const settings = getSettings();
			expect(settings.theme).toBe('dark');
		});

		it('merges theme default for existing users who lack theme in localStorage', () => {
			localStorage.setItem(
				SETTINGS_STORAGE_KEY,
				JSON.stringify({ fuelUnit: 'MPG', currency: '$' })
			);
			const settings = getSettings();
			expect(settings.fuelUnit).toBe('MPG');
			expect(settings.currency).toBe('$');
			expect(settings.theme).toBe('system');
		});

		it('falls back to default theme when stored value is invalid', () => {
			localStorage.setItem(
				SETTINGS_STORAGE_KEY,
				JSON.stringify({ fuelUnit: DEFAULT_UNIT, currency: DEFAULT_CURRENCY, theme: 'neon' })
			);
			const settings = getSettings();
			expect(settings.theme).toBe('system');
		});

		it('falls back to default theme when stored value is not a string', () => {
			localStorage.setItem(
				SETTINGS_STORAGE_KEY,
				JSON.stringify({ fuelUnit: DEFAULT_UNIT, currency: DEFAULT_CURRENCY, theme: 123 })
			);
			const settings = getSettings();
			expect(settings.theme).toBe('system');
		});
	});

	describe('saveSettings()', () => {
		it('persists settings as serialised JSON in localStorage', () => {
			expect(saveSettings({ fuelUnit: 'MPG', currency: '£', theme: 'dark' }).error).toBeNull();
			const raw = localStorage.getItem(SETTINGS_STORAGE_KEY);
			expect(raw).not.toBeNull();
			expect(JSON.parse(raw!)).toEqual({ fuelUnit: 'MPG', currency: '£', theme: 'dark' });
		});

		it('persists custom currency prefixes without trimming them', () => {
			saveSettings({ fuelUnit: DEFAULT_UNIT, currency: 'EUR ', theme: 'system' });
			const settings = getSettings();
			expect(settings).toEqual({ fuelUnit: DEFAULT_UNIT, currency: 'EUR ', theme: 'system' });
		});

		it('falls back to the default currency when saving a blank-only prefix', () => {
			saveSettings({ fuelUnit: DEFAULT_UNIT, currency: '   ', theme: 'system' });
			const settings = getSettings();
			expect(settings.currency).toBe(DEFAULT_CURRENCY);
		});

		it('overwrites previously saved settings', () => {
			saveSettings({ fuelUnit: 'L/100km', currency: '€', theme: 'system' });
			saveSettings({ fuelUnit: 'MPG', currency: '$', theme: 'dark' });
			const settings = getSettings();
			expect(settings.fuelUnit).toBe('MPG');
			expect(settings.currency).toBe('$');
			expect(settings.theme).toBe('dark');
		});

		it('uses the correct localStorage key', () => {
			saveSettings({ fuelUnit: DEFAULT_UNIT, currency: DEFAULT_CURRENCY, theme: 'system' });
			expect(localStorage.getItem(SETTINGS_STORAGE_KEY)).not.toBeNull();
		});

		it('persists theme value', () => {
			saveSettings({ fuelUnit: DEFAULT_UNIT, currency: DEFAULT_CURRENCY, theme: 'light' });
			const settings = getSettings();
			expect(settings.theme).toBe('light');
		});

		it('falls back to default theme when saving an invalid theme', () => {
			saveSettings({
				fuelUnit: DEFAULT_UNIT,
				currency: DEFAULT_CURRENCY,
				theme: 'neon' as AppSettings['theme']
			});
			const settings = getSettings();
			expect(settings.theme).toBe('system');
		});

		it('does not throw when localStorage.setItem throws QuotaExceededError', () => {
			const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementationOnce(() => {
				throw new DOMException('QuotaExceededError', 'QuotaExceededError');
			});
			expect(
				saveSettings({ fuelUnit: DEFAULT_UNIT, currency: DEFAULT_CURRENCY, theme: 'system' }).error
			).not.toBeNull();
			spy.mockRestore();
		});

		it('does not throw when localStorage.setItem throws SecurityError', () => {
			const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementationOnce(() => {
				throw new DOMException('SecurityError', 'SecurityError');
			});
			expect(
				saveSettings({ fuelUnit: DEFAULT_UNIT, currency: DEFAULT_CURRENCY, theme: 'system' }).error
			).not.toBeNull();
			spy.mockRestore();
		});
	});

	describe('S34: saveSettings() reports coercion instead of silent success', () => {
		it('reports an empty coercedFields array when the input is entirely valid', () => {
			const result = saveSettings({
				fuelUnit: DEFAULT_UNIT,
				currency: DEFAULT_CURRENCY,
				theme: 'system'
			});
			expect(result.error).toBeNull();
			expect(result.data?.coercedFields).toEqual([]);
		});

		it('reports fuelUnit/currency/theme when each is invalid and silently defaulted', () => {
			const result = saveSettings({
				fuelUnit: 'bogus' as AppSettings['fuelUnit'],
				currency: '   ',
				theme: 'neon' as AppSettings['theme']
			});
			expect(result.data?.coercedFields).toEqual(
				expect.arrayContaining(['fuelUnit', 'currency', 'theme'])
			);
		});

		it('reports exchangeRates when an entry is invalid and gets dropped', () => {
			const result = saveSettings({
				fuelUnit: DEFAULT_UNIT,
				currency: DEFAULT_CURRENCY,
				theme: 'system',
				exchangeRates: { $: -5 }
			});
			expect(result.data?.coercedFields).toContain('exchangeRates');
		});

		it('does NOT report exchangeRates when every entry is valid', () => {
			const result = saveSettings({
				fuelUnit: DEFAULT_UNIT,
				currency: DEFAULT_CURRENCY,
				theme: 'system',
				exchangeRates: { $: 1.1 }
			});
			expect(result.data?.coercedFields).not.toContain('exchangeRates');
		});

		it('review fix: reports exchangeRates when it is a malformed non-object value (e.g. corrupted backup JSON), not just a bad entry', () => {
			const result = saveSettings({
				fuelUnit: DEFAULT_UNIT,
				currency: DEFAULT_CURRENCY,
				theme: 'system',
				exchangeRates: 'not-an-object' as unknown as AppSettings['exchangeRates']
			});
			expect(result.data?.coercedFields).toContain('exchangeRates');
		});

		it('reports heroMetric when an invalid value is silently dropped', () => {
			const result = saveSettings({
				fuelUnit: DEFAULT_UNIT,
				currency: DEFAULT_CURRENCY,
				theme: 'system',
				heroMetric: 'bogus' as AppSettings['heroMetric']
			});
			expect(result.data?.coercedFields).toContain('heroMetric');
		});

		it('does NOT report heroMetric when absent', () => {
			const result = saveSettings({
				fuelUnit: DEFAULT_UNIT,
				currency: DEFAULT_CURRENCY,
				theme: 'system'
			});
			expect(result.data?.coercedFields).not.toContain('heroMetric');
		});
	});

	describe('exchangeRates', () => {
		it('omits exchangeRates entirely when absent (byte-identical back-compat)', () => {
			saveSettings({ fuelUnit: DEFAULT_UNIT, currency: DEFAULT_CURRENCY, theme: 'system' });
			const raw = localStorage.getItem(SETTINGS_STORAGE_KEY);
			expect(JSON.parse(raw!)).toEqual({
				fuelUnit: DEFAULT_UNIT,
				currency: DEFAULT_CURRENCY,
				theme: 'system'
			});
			expect('exchangeRates' in getSettings()).toBe(false);
		});

		it('persists and reloads finite > 0 rates', () => {
			saveSettings({
				fuelUnit: DEFAULT_UNIT,
				currency: 'Ft',
				theme: 'system',
				exchangeRates: { '€': 400, $: 360 }
			});
			expect(getSettings().exchangeRates).toEqual({ '€': 400, $: 360 });
		});

		it('drops blank/NaN/zero/negative rates on save and keeps only valid ones', () => {
			saveSettings({
				fuelUnit: DEFAULT_UNIT,
				currency: 'Ft',
				theme: 'system',
				exchangeRates: {
					'€': 400,
					$: 0,
					'£': -5,
					zł: Number.NaN,
					kr: Number.POSITIVE_INFINITY
				} as Record<string, number>
			});
			expect(getSettings().exchangeRates).toEqual({ '€': 400 });
		});

		it('omits exchangeRates when no entry survives validation', () => {
			saveSettings({
				fuelUnit: DEFAULT_UNIT,
				currency: 'Ft',
				theme: 'system',
				exchangeRates: { '€': 0, $: -1 } as Record<string, number>
			});
			expect(getSettings().exchangeRates).toBeUndefined();
			expect('exchangeRates' in JSON.parse(localStorage.getItem(SETTINGS_STORAGE_KEY)!)).toBe(
				false
			);
		});

		it('sanitises invalid persisted rates on read (drops non-number/≤0 values)', () => {
			localStorage.setItem(
				SETTINGS_STORAGE_KEY,
				JSON.stringify({
					fuelUnit: DEFAULT_UNIT,
					currency: 'Ft',
					theme: 'system',
					exchangeRates: { '€': 400, $: 'oops', '£': 0 }
				})
			);
			expect(getSettings().exchangeRates).toEqual({ '€': 400 });
		});

		it('ignores a non-object exchangeRates value on read', () => {
			localStorage.setItem(
				SETTINGS_STORAGE_KEY,
				JSON.stringify({
					fuelUnit: DEFAULT_UNIT,
					currency: 'Ft',
					theme: 'system',
					exchangeRates: 'nope'
				})
			);
			expect(getSettings().exchangeRates).toBeUndefined();
		});
	});

	describe('heroMetric', () => {
		it('omits heroMetric entirely when absent (byte-identical back-compat, like exchangeRates)', () => {
			saveSettings({ fuelUnit: DEFAULT_UNIT, currency: DEFAULT_CURRENCY, theme: 'system' });
			const raw = localStorage.getItem(SETTINGS_STORAGE_KEY);
			expect('heroMetric' in JSON.parse(raw!)).toBe(false);
			expect('heroMetric' in getSettings()).toBe(false);
		});

		it('round-trips a stored consumption choice', () => {
			saveSettings({
				fuelUnit: DEFAULT_UNIT,
				currency: DEFAULT_CURRENCY,
				theme: 'system',
				heroMetric: 'consumption'
			});
			expect(getSettings().heroMetric).toBe('consumption');
		});

		it('round-trips an explicit cost choice', () => {
			saveSettings({
				fuelUnit: DEFAULT_UNIT,
				currency: DEFAULT_CURRENCY,
				theme: 'system',
				heroMetric: 'cost'
			});
			expect(getSettings().heroMetric).toBe('cost');
		});

		it('drops an invalid heroMetric on save (so the consumer defaults to cost)', () => {
			saveSettings({
				fuelUnit: DEFAULT_UNIT,
				currency: DEFAULT_CURRENCY,
				theme: 'system',
				heroMetric: 'efficiency' as AppSettings['heroMetric']
			});
			expect('heroMetric' in getSettings()).toBe(false);
		});

		it('drops an invalid persisted heroMetric on read', () => {
			localStorage.setItem(
				SETTINGS_STORAGE_KEY,
				JSON.stringify({
					fuelUnit: DEFAULT_UNIT,
					currency: DEFAULT_CURRENCY,
					theme: 'system',
					heroMetric: 42
				})
			);
			expect('heroMetric' in getSettings()).toBe(false);
		});
	});
});
