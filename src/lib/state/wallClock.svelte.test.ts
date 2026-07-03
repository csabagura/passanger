import { describe, it, expect, vi, afterEach } from 'vitest';
import { createWallClock } from './wallClock.svelte';

// Story 8.5 / S20 / AD-RT-7: shared reactive wall-clock replacing mount-frozen `new Date()` prop
// defaults. Runs in the default jsdom test environment, which provides `document`/`window`.

const clocks: ReturnType<typeof createWallClock>[] = [];
function makeClock() {
	const clock = createWallClock();
	clocks.push(clock);
	return clock;
}

afterEach(() => {
	for (const clock of clocks) clock.destroy();
	clocks.length = 0;
	vi.useRealTimers();
});

describe('createWallClock', () => {
	it('seeds `now` with the current time at creation', () => {
		const before = Date.now();
		const clock = makeClock();
		const after = Date.now();
		expect(clock.now.getTime()).toBeGreaterThanOrEqual(before);
		expect(clock.now.getTime()).toBeLessThanOrEqual(after);
	});

	it('refreshes `now` on a visibilitychange event while the tab is visible', () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date(2026, 5, 1));
		const clock = makeClock();
		const first = clock.now;

		vi.setSystemTime(new Date(2026, 5, 15));
		Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
		document.dispatchEvent(new Event('visibilitychange'));

		expect(clock.now.getTime()).not.toBe(first.getTime());
		expect(clock.now).toEqual(new Date(2026, 5, 15));
	});

	it('does NOT refresh on a visibilitychange event while the tab is hidden', () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date(2026, 5, 1));
		const clock = makeClock();
		const first = clock.now;

		vi.setSystemTime(new Date(2026, 5, 15));
		Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
		document.dispatchEvent(new Event('visibilitychange'));

		expect(clock.now.getTime()).toBe(first.getTime());
	});

	it('refreshes `now` on a pageshow event', () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date(2026, 5, 1));
		const clock = makeClock();
		const first = clock.now;

		vi.setSystemTime(new Date(2026, 5, 20));
		window.dispatchEvent(new Event('pageshow'));

		expect(clock.now.getTime()).not.toBe(first.getTime());
		expect(clock.now).toEqual(new Date(2026, 5, 20));
	});

	it('destroy() removes the listeners — no further refresh after teardown', () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date(2026, 5, 1));
		const clock = createWallClock();
		clock.destroy();

		vi.setSystemTime(new Date(2026, 5, 20));
		Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
		document.dispatchEvent(new Event('visibilitychange'));
		window.dispatchEvent(new Event('pageshow'));

		expect(clock.now).toEqual(new Date(2026, 5, 1));
	});

	it('destroy() is idempotent (safe to call more than once)', () => {
		const clock = createWallClock();
		expect(() => {
			clock.destroy();
			clock.destroy();
		}).not.toThrow();
	});
});
