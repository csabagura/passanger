/**
 * Layout shell integration tests using the REAL src/routes/+layout.svelte.
 * Previous version mounted NavBar and UpdatePrompt independently, so regressions
 * in real shell composition, padding, or DOM order would pass undetected.
 * These tests render +layout.svelte directly to catch such regressions.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, cleanup } from '@testing-library/svelte';
import { createRawSnippet, flushSync } from 'svelte';
import { SHELL_NAVBAR_HEIGHT, UPDATE_PROMPT_CLEARANCE } from '$lib/config';
import Layout from '../../routes/+layout.svelte';

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

// Capture onNeedRefresh callback to trigger UpdatePrompt banner in tests
let capturedOnNeedRefresh: (() => void) | undefined;
const mockUpdateSW = vi.fn();

vi.mock('virtual:pwa-register', () => ({
	registerSW: vi.fn((callbacks: { onNeedRefresh?: () => void; onOfflineReady?: () => void }) => {
		capturedOnNeedRefresh = callbacks.onNeedRefresh;
		return mockUpdateSW;
	})
}));

// Simple children snippet — renders a paragraph inside the layout slot
const childrenSnippet = createRawSnippet(() => ({
	render: () => `<p data-testid="page-content">Page content</p>`,
	setup: () => {}
}));

function expectSafeAreaOffset(style: string, offset: string) {
	expect(style).toContain(offset);
	expect(style).toContain('safe-area-inset-bottom');
}

function sumRemOffsets(...offsets: string[]) {
	const total = offsets.reduce((sum, offset) => sum + Number.parseFloat(offset), 0);
	return `${total}rem`;
}

describe('Layout shell (real +layout.svelte)', () => {
	beforeEach(() => {
		cleanup();
		mockPathname = '/fuel-entry';
		capturedOnNeedRefresh = undefined;
	});

	it('renders the NavBar navigation landmark', () => {
		render(Layout, { children: childrenSnippet });
		const nav = document.querySelector('nav[aria-label="Main navigation"]');
		expect(nav).toBeTruthy();
	});

	it('main element has correct padding-bottom to clear NavBar + safe area', () => {
		render(Layout, { children: childrenSnippet });
		const main = document.querySelector('main');
		const style = main?.getAttribute('style') ?? '';
		expectSafeAreaOffset(style, SHELL_NAVBAR_HEIGHT);
	});

	it('main element contains a desktop-centered container with max-width 480px at lg breakpoint only', () => {
		render(Layout, { children: childrenSnippet });
		const container = document.querySelector('main > div');
		expect(container).toBeTruthy();
		// lg:max-w-[480px] — constraint applies at 1024px+ per UX spec; narrower viewports stay full-width
		expect(container?.className).toContain('lg:max-w-[480px]');
		expect(container?.className).toContain('mx-auto');
	});

	it('children content renders inside the desktop container', () => {
		render(Layout, { children: childrenSnippet });
		const content = document.querySelector('[data-testid="page-content"]');
		expect(content).toBeTruthy();
		// Verify it is inside main > div (the centered container)
		const container = document.querySelector('main > div');
		expect(container?.contains(content)).toBe(true);
	});

	it('UpdatePrompt is hidden initially (no refresh available)', () => {
		render(Layout, { children: childrenSnippet });
		expect(document.querySelector('[role="status"]')).toBeNull();
	});

	it('UpdatePrompt appears above NavBar with correct safe-area offset when refresh available', () => {
		render(Layout, { children: childrenSnippet });
		flushSync(() => capturedOnNeedRefresh?.());

		const banner = document.querySelector('[role="status"]');
		const style = banner?.getAttribute('style') ?? '';
		expectSafeAreaOffset(style, SHELL_NAVBAR_HEIGHT);
	});

	it('expands main padding-bottom when the fixed update banner is visible', () => {
		render(Layout, { children: childrenSnippet });
		flushSync(() => capturedOnNeedRefresh?.());

		const main = document.querySelector('main');
		const style = main?.getAttribute('style') ?? '';
		expectSafeAreaOffset(style, sumRemOffsets(SHELL_NAVBAR_HEIGHT, UPDATE_PROMPT_CLEARANCE));
	});

	it('NavBar (z-40) has lower z-index than UpdatePrompt (z-50)', () => {
		render(Layout, { children: childrenSnippet });
		flushSync(() => capturedOnNeedRefresh?.());

		const nav = document.querySelector('nav[aria-label="Main navigation"]');
		const banner = document.querySelector('[role="status"]');
		expect(nav?.className).toContain('z-40');
		expect(banner?.className).toContain('z-50');
	});

	it('NavBar is rendered after main in DOM order', () => {
		render(Layout, { children: childrenSnippet });
		const elements = document.body.querySelectorAll('main, nav');
		expect(elements[0].tagName.toLowerCase()).toBe('main');
		expect(elements[1].tagName.toLowerCase()).toBe('nav');
	});
});
