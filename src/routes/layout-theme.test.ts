/**
 * Layout theme effect tests (Story 6.2, Task 5.3)
 *
 * Covers:
 * - .dark class toggled on <html> based on settings.theme
 * - System preference respected when theme is 'system'
 * - Manual override takes precedence over system preference
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/svelte';
import { createRawSnippet, flushSync } from 'svelte';
import Layout from './+layout.svelte';

let mockPathname = '/fuel-entry';

vi.mock('$app/state', () => ({
	page: {
		get url() {
			return new URL(`http://localhost${mockPathname}`);
		}
	}
}));

vi.mock('$app/paths', () => ({
	resolve: (path: string) => path
}));

vi.mock('virtual:pwa-register', () => ({
	registerSW: vi.fn(() => vi.fn())
}));

// Mock matchMedia for theme and display-mode queries
let prefersDarkMatches = false;
const changeListeners: Array<(e: { matches: boolean }) => void> = [];

const mockMatchMedia = vi.fn((query: string) => {
	if (query === '(prefers-color-scheme: dark)') {
		return {
			get matches() {
				return prefersDarkMatches;
			},
			addEventListener: vi.fn((event: string, cb: (e: { matches: boolean }) => void) => {
				if (event === 'change') changeListeners.push(cb);
			}),
			removeEventListener: vi.fn((event: string, cb: (e: { matches: boolean }) => void) => {
				const idx = changeListeners.indexOf(cb);
				if (idx >= 0) changeListeners.splice(idx, 1);
			})
		};
	}
	// display-mode: standalone
	return {
		matches: false,
		addEventListener: vi.fn(),
		removeEventListener: vi.fn(),
		addListener: vi.fn(),
		removeListener: vi.fn()
	};
});

Object.defineProperty(window, 'matchMedia', { value: mockMatchMedia, writable: true });

// Settings mock — we control the theme value
let mockTheme: 'system' | 'light' | 'dark' = 'system';

vi.mock('$lib/utils/settings', () => ({
	getSettings: () => ({
		fuelUnit: 'L/100km' as const,
		currency: '€' as const,
		theme: mockTheme
	})
}));

const childrenSnippet = createRawSnippet(() => ({
	render: () => `<p>content</p>`,
	setup: () => {}
}));

describe('Layout theme effect', () => {
	beforeEach(() => {
		cleanup();
		prefersDarkMatches = false;
		mockTheme = 'system';
		changeListeners.length = 0;
		document.documentElement.classList.remove('dark');
	});

	afterEach(() => {
		cleanup();
		document.documentElement.classList.remove('dark');
	});

	it('does not add .dark class when theme is system and OS prefers light', () => {
		prefersDarkMatches = false;
		mockTheme = 'system';

		render(Layout, { props: { children: childrenSnippet } });
		flushSync();

		expect(document.documentElement.classList.contains('dark')).toBe(false);
	});

	it('adds .dark class when theme is system and OS prefers dark', () => {
		prefersDarkMatches = true;
		mockTheme = 'system';

		render(Layout, { props: { children: childrenSnippet } });
		flushSync();

		expect(document.documentElement.classList.contains('dark')).toBe(true);
	});

	it('adds .dark class when theme is dark regardless of OS preference', () => {
		prefersDarkMatches = false;
		mockTheme = 'dark';

		render(Layout, { props: { children: childrenSnippet } });
		flushSync();

		expect(document.documentElement.classList.contains('dark')).toBe(true);
	});

	it('removes .dark class when theme is light regardless of OS preference', () => {
		prefersDarkMatches = true;
		mockTheme = 'light';
		document.documentElement.classList.add('dark');

		render(Layout, { props: { children: childrenSnippet } });
		flushSync();

		expect(document.documentElement.classList.contains('dark')).toBe(false);
	});

	it('reacts to real-time OS preference change when theme is system', () => {
		prefersDarkMatches = false;
		mockTheme = 'system';

		render(Layout, { props: { children: childrenSnippet } });
		flushSync();

		expect(document.documentElement.classList.contains('dark')).toBe(false);

		// Simulate OS switching to dark mode
		prefersDarkMatches = true;
		changeListeners.forEach((cb) => cb({ matches: true }));

		expect(document.documentElement.classList.contains('dark')).toBe(true);
	});
});
