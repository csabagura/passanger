import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/svelte';
import { flushSync } from 'svelte';
import SettingsContextConsumer from './SettingsContextConsumer.test.svelte';
import SettingsContextProvider from './SettingsContextProvider.test.svelte';
import type { AppSettings } from '$lib/utils/settings';

vi.mock('$lib/utils/settings', () => ({
	getSettings: () => ({ fuelUnit: 'L/100km' as const, currency: '€' as const })
}));

afterEach(() => {
	cleanup();
});

describe('settings context — getter-based contract (layout.svelte pattern)', () => {
	it('getter reflects updateSettings changes at the JavaScript level', () => {
		// Verifies the exact pattern used in +layout.svelte is self-consistent
		let settings: AppSettings = { fuelUnit: 'L/100km', currency: '€' };

		const ctx = {
			get settings() {
				return settings;
			},
			updateSettings(s: AppSettings) {
				settings = s;
			}
		};

		expect(ctx.settings.fuelUnit).toBe('L/100km');
		ctx.updateSettings({ fuelUnit: 'MPG', currency: '€' });
		expect(ctx.settings.fuelUnit).toBe('MPG');
		expect(ctx.settings.currency).toBe('€');
	});

	it('consumer reads initial settings value from pre-populated context', () => {
		// Verifies a consumer component can read settings via getContext('settings')
		const ctx = {
			get settings() {
				return { fuelUnit: 'MPG' as const, currency: '$' as const };
			},
			updateSettings: vi.fn()
		};

		render(SettingsContextConsumer, {
			context: new Map([['settings', ctx]])
		});

		expect(screen.getByTestId('fuel-unit').textContent).toBe('MPG');
		expect(screen.getByTestId('currency').textContent).toBe('$');
	});
});

describe('settings context — Svelte $state reactivity (consumer propagation)', () => {
	it('consumer component updates when updateSettings is called via $state provider', async () => {
		// Proves the full reactive chain: $state in layout → getter in context → consumer DOM
		// This tests the exact same setContext pattern as +layout.svelte uses
		let capturedCtx: { settings: AppSettings; updateSettings: (s: AppSettings) => void } | null =
			null;

		render(SettingsContextProvider, {
			props: {
				initialSettings: { fuelUnit: 'L/100km', currency: '€' },
				onContextCreated: (ctx) => {
					capturedCtx = ctx;
				}
			}
		});

		// Initial render: consumer shows initial value
		expect(screen.getByTestId('fuel-unit').textContent).toBe('L/100km');
		expect(screen.getByTestId('currency').textContent).toBe('€');

		// Call updateSettings — triggers $state reactivity in the provider
		capturedCtx!.updateSettings({ fuelUnit: 'MPG', currency: '$' });
		flushSync();

		// Consumer DOM must reflect the updated settings
		expect(screen.getByTestId('fuel-unit').textContent).toBe('MPG');
		expect(screen.getByTestId('currency').textContent).toBe('$');
	});

	it('multiple updateSettings calls all propagate to the consumer', async () => {
		let capturedCtx: { settings: AppSettings; updateSettings: (s: AppSettings) => void } | null =
			null;

		render(SettingsContextProvider, {
			props: {
				initialSettings: { fuelUnit: 'L/100km', currency: '€' },
				onContextCreated: (ctx) => {
					capturedCtx = ctx;
				}
			}
		});

		capturedCtx!.updateSettings({ fuelUnit: 'MPG', currency: '€' });
		flushSync();
		expect(screen.getByTestId('fuel-unit').textContent).toBe('MPG');

		capturedCtx!.updateSettings({ fuelUnit: 'L/100km', currency: '$' });
		flushSync();
		expect(screen.getByTestId('fuel-unit').textContent).toBe('L/100km');
		expect(screen.getByTestId('currency').textContent).toBe('$');
	});
});
