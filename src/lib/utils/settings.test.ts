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
			expect(saveSettings({ fuelUnit: 'MPG', currency: '£', theme: 'dark' })).toBe(true);
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
			expect(saveSettings({ fuelUnit: DEFAULT_UNIT, currency: DEFAULT_CURRENCY, theme: 'system' })).toBe(false);
			spy.mockRestore();
		});

		it('does not throw when localStorage.setItem throws SecurityError', () => {
			const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementationOnce(() => {
				throw new DOMException('SecurityError', 'SecurityError');
			});
			expect(saveSettings({ fuelUnit: DEFAULT_UNIT, currency: DEFAULT_CURRENCY, theme: 'system' })).toBe(false);
			spy.mockRestore();
		});
	});
});
