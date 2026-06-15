import { describe, it, expect } from 'vitest';
import {
	DB_NAME,
	DB_VERSION,
	DEFAULT_CURRENCY,
	DEFAULT_UNIT,
	PRESET_CURRENCIES,
	SUPPORTED_UNITS
} from './config';

describe('config', () => {
	it('exports correct DB_NAME with double-a brand name', () => {
		expect(DB_NAME).toBe('passangerDB');
	});

	it('exports DB_VERSION as 4 (with v4 serviceReminders store)', () => {
		expect(DB_VERSION).toBe(4);
	});

	it('exports supported fuel units', () => {
		expect(SUPPORTED_UNITS).toContain('L/100km');
		expect(SUPPORTED_UNITS).toContain('MPG');
	});

	it('exports supported currencies', () => {
		expect(PRESET_CURRENCIES).toContain('€');
		expect(PRESET_CURRENCIES).toContain('$');
		expect(PRESET_CURRENCIES).toContain('£');
	});

	it('exports correct defaults', () => {
		expect(DEFAULT_UNIT).toBe('L/100km');
		expect(DEFAULT_CURRENCY).toBe('€');
	});
});
