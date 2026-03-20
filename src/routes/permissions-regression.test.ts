/**
 * Permission regression guard (Story 6.1 follow-up)
 *
 * Ensures no permission-requesting APIs are called during normal app load.
 * Guards against future regressions that might add launch-time permission prompts
 * (violating FR40 / UX-DR20).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/svelte';
import { createRawSnippet, flushSync } from 'svelte';
import Layout from './+layout.svelte';

let mockPathname = '/log';

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

vi.mock('$lib/utils/settings', () => ({
	getSettings: () => ({
		fuelUnit: 'L/100km' as const,
		currency: '€' as const,
		theme: 'system'
	})
}));

// Mock matchMedia
Object.defineProperty(window, 'matchMedia', {
	value: vi.fn((query: string) => ({
		matches: false,
		addEventListener: vi.fn(),
		removeEventListener: vi.fn(),
		addListener: vi.fn(),
		removeListener: vi.fn()
	})),
	writable: true
});

const childrenSnippet = createRawSnippet(() => ({
	render: () => `<p>content</p>`,
	setup: () => {}
}));

describe('Permission regression guard', () => {
	const requestPermissionSpy = vi.fn();
	const getUserMediaSpy = vi.fn();
	const permissionsQuerySpy = vi.fn();

	beforeEach(() => {
		cleanup();
		localStorage.clear();
		// Set session count >= 2 so install prompt logic doesn't interfere
		localStorage.setItem('passanger_session_count', '2');

		vi.clearAllMocks();

		// Mock Notification.requestPermission
		Object.defineProperty(globalThis, 'Notification', {
			value: { requestPermission: requestPermissionSpy, permission: 'default' },
			writable: true,
			configurable: true
		});

		// Mock navigator.mediaDevices.getUserMedia
		Object.defineProperty(navigator, 'mediaDevices', {
			value: { getUserMedia: getUserMediaSpy },
			writable: true,
			configurable: true
		});

		// Mock navigator.permissions.query
		Object.defineProperty(navigator, 'permissions', {
			value: { query: permissionsQuerySpy },
			writable: true,
			configurable: true
		});
	});

	afterEach(() => {
		cleanup();
	});

	it('does not call Notification.requestPermission on app load', () => {
		render(Layout, { props: { children: childrenSnippet } });
		flushSync();

		expect(requestPermissionSpy).not.toHaveBeenCalled();
	});

	it('does not call navigator.mediaDevices.getUserMedia on app load', () => {
		render(Layout, { props: { children: childrenSnippet } });
		flushSync();

		expect(getUserMediaSpy).not.toHaveBeenCalled();
	});

	it('does not call navigator.permissions.query on app load', () => {
		render(Layout, { props: { children: childrenSnippet } });
		flushSync();

		expect(permissionsQuerySpy).not.toHaveBeenCalled();
	});
});
