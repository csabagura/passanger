import { describe, it, expect, vi } from 'vitest';
import { consumeCaptureDeepLink } from './captureDeepLink';
import { createCaptureSheet } from './captureSheet.svelte';

describe('consumeCaptureDeepLink', () => {
	it('opens the sheet on Fuel and strips the param for ?capture=fuel', () => {
		const capture = createCaptureSheet();
		const openSpy = vi.spyOn(capture, 'openSheet');
		const strip = vi.fn();

		const acted = consumeCaptureDeepLink(
			new URL('http://localhost/history?capture=fuel'),
			capture,
			strip
		);

		expect(acted).toBe(true);
		expect(openSpy).toHaveBeenCalledWith('fuel');
		expect(capture.open).toBe(true);
		expect(capture.mode).toBe('fuel');
		// stripped URL no longer carries the param (so reload/back/close won't re-trigger)
		expect(strip).toHaveBeenCalledTimes(1);
		const cleaned = strip.mock.calls[0][0] as URL;
		expect(cleaned.searchParams.has('capture')).toBe(false);
		expect(cleaned.pathname).toBe('/history');
	});

	it('opens the sheet on Expense for ?capture=expense', () => {
		const capture = createCaptureSheet();
		const strip = vi.fn();

		const acted = consumeCaptureDeepLink(
			new URL('http://localhost/log?capture=expense'),
			capture,
			strip
		);

		expect(acted).toBe(true);
		expect(capture.mode).toBe('expense');
		expect(capture.open).toBe(true);
		expect(strip).toHaveBeenCalledTimes(1);
	});

	it('preserves other query params when stripping', () => {
		const capture = createCaptureSheet();
		const strip = vi.fn();

		consumeCaptureDeepLink(new URL('http://localhost/log?capture=fuel&foo=bar'), capture, strip);

		const cleaned = strip.mock.calls[0][0] as URL;
		expect(cleaned.searchParams.has('capture')).toBe(false);
		expect(cleaned.searchParams.get('foo')).toBe('bar');
	});

	it('is a no-op for an absent or unrecognized value', () => {
		const capture = createCaptureSheet();
		const openSpy = vi.spyOn(capture, 'openSheet');
		const strip = vi.fn();

		expect(consumeCaptureDeepLink(new URL('http://localhost/log'), capture, strip)).toBe(false);
		expect(
			consumeCaptureDeepLink(new URL('http://localhost/log?capture=bogus'), capture, strip)
		).toBe(false);

		expect(openSpy).not.toHaveBeenCalled();
		expect(strip).not.toHaveBeenCalled();
		expect(capture.open).toBe(false);
	});
});
