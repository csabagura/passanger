import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
	getInstallPromptPlatform,
	hasInstallPromptBeenDismissed,
	isStandaloneDisplayMode,
	markInstallPromptDismissed
} from './installPrompt';

const localStorageMock = (() => {
	let store: Record<string, string> = {};
	return {
		getItem: (key: string) => store[key] ?? null,
		setItem: (key: string, value: string) => {
			store[key] = value;
		},
		clear: () => {
			store = {};
		}
	};
})();

Object.defineProperty(globalThis, 'localStorage', {
	value: localStorageMock,
	writable: true,
	configurable: true
});

describe('installPrompt utilities', () => {
	beforeEach(() => {
		localStorageMock.clear();
	});

	describe('dismissal helpers', () => {
		it('stores dismissal without throwing', () => {
			expect(hasInstallPromptBeenDismissed()).toBe(false);
			markInstallPromptDismissed();
			expect(hasInstallPromptBeenDismissed()).toBe(true);
		});

		it('falls back cleanly when localStorage throws', () => {
			const originalSetItem = localStorageMock.setItem;
			localStorageMock.setItem = () => {
				throw new DOMException('Blocked', 'SecurityError');
			};

			expect(() => markInstallPromptDismissed()).not.toThrow();
			expect(hasInstallPromptBeenDismissed()).toBe(false);

			localStorageMock.setItem = originalSetItem;
		});
	});

	describe('platform detection', () => {
		it('detects iOS Safari', () => {
			expect(
				getInstallPromptPlatform({
					userAgent:
						'Mozilla/5.0 (iPhone; CPU iPhone OS 18_3 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.3 Mobile/15E148 Safari/604.1',
					platform: 'iPhone',
					maxTouchPoints: 5
				} as Navigator)
			).toBe('ios');
		});

		it('detects Android browsers', () => {
			expect(
				getInstallPromptPlatform({
					userAgent:
						'Mozilla/5.0 (Linux; Android 15; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Mobile Safari/537.36',
					platform: 'Linux armv8l',
					maxTouchPoints: 5
				} as Navigator)
			).toBe('android');
		});

		it('returns unsupported for non-mobile browsers', () => {
			expect(
				getInstallPromptPlatform({
					userAgent:
						'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36',
					platform: 'MacIntel',
					maxTouchPoints: 0
				} as Navigator)
			).toBe('unsupported');
		});
	});

	describe('standalone detection', () => {
		let originalMatchMedia: typeof window.matchMedia | undefined;

		beforeEach(() => {
			originalMatchMedia = window.matchMedia;
		});

		afterEach(() => {
			if (originalMatchMedia) {
				window.matchMedia = originalMatchMedia;
			}
		});

		it('reads the display-mode media query when available', () => {
			window.matchMedia = ((query: string) =>
				({
					matches: query === '(display-mode: standalone)'
				}) as MediaQueryList) as typeof window.matchMedia;

			expect(isStandaloneDisplayMode(window)).toBe(true);
		});

		it('returns false when matchMedia is unavailable', () => {
			expect(isStandaloneDisplayMode({} as Window)).toBe(false);
		});
	});
});
