import { describe, it, expect } from 'vitest';
import { createCaptureSheet } from './captureSheet.svelte';

describe('createCaptureSheet', () => {
	it('starts closed on the Fuel segment', () => {
		const capture = createCaptureSheet();
		expect(capture.open).toBe(false);
		expect(capture.mode).toBe('fuel');
	});

	it('openSheet() opens without changing the mode (FAB → fresh Fuel)', () => {
		const capture = createCaptureSheet();
		capture.openSheet();
		expect(capture.open).toBe(true);
		expect(capture.mode).toBe('fuel');
	});

	it("openSheet('expense') opens on the Expense segment", () => {
		const capture = createCaptureSheet();
		capture.openSheet('expense');
		expect(capture.open).toBe(true);
		expect(capture.mode).toBe('expense');
	});

	it('setMode() flips the segment without changing open', () => {
		const capture = createCaptureSheet();
		capture.setMode('expense');
		expect(capture.mode).toBe('expense');
		expect(capture.open).toBe(false);

		capture.openSheet();
		capture.setMode('fuel');
		expect(capture.mode).toBe('fuel');
		expect(capture.open).toBe(true);
	});

	it('close() closes the sheet', () => {
		const capture = createCaptureSheet();
		capture.openSheet('expense');
		capture.close();
		expect(capture.open).toBe(false);
		// mode is sticky across a close — only a fresh openSheet(mode) resets it
		expect(capture.mode).toBe('expense');
	});
});
