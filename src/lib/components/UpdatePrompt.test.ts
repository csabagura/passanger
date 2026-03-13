import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';
import { flushSync } from 'svelte';
import UpdatePrompt from './UpdatePrompt.svelte';
import { SHELL_NAVBAR_HEIGHT } from '$lib/config';

// Capture callbacks registered by the component so tests can trigger them
let capturedOnNeedRefresh: (() => void) | undefined;
const mockUpdateSW = vi.fn();

vi.mock('virtual:pwa-register', () => ({
	registerSW: vi.fn((callbacks: { onNeedRefresh?: () => void; onOfflineReady?: () => void }) => {
		capturedOnNeedRefresh = callbacks.onNeedRefresh;
		return mockUpdateSW;
	})
}));

describe('UpdatePrompt', () => {
	beforeEach(() => {
		capturedOnNeedRefresh = undefined;
		mockUpdateSW.mockClear();
	});

	it('banner is hidden on initial render', () => {
		render(UpdatePrompt);
		expect(screen.queryByRole('status')).toBeNull();
	});

	it('shows "Update available" banner when onNeedRefresh fires', () => {
		render(UpdatePrompt);
		flushSync(() => capturedOnNeedRefresh?.());
		const banner = screen.getByRole('status');
		expect(banner.textContent).toContain('Update available');
	});

	it('Reload button calls updateSW(true)', () => {
		render(UpdatePrompt);
		flushSync(() => capturedOnNeedRefresh?.());
		const button = screen.getByRole('button', { name: /reload/i });
		fireEvent.click(button);
		expect(mockUpdateSW).toHaveBeenCalledWith(true);
		expect(mockUpdateSW).toHaveBeenCalledTimes(1);
	});

	it('banner is positioned above NavBar with safe-area offset', () => {
		render(UpdatePrompt);
		flushSync(() => capturedOnNeedRefresh?.());
		const banner = screen.getByRole('status');
		// Check raw style attribute — jsdom mangles env() in the parsed style property
		const rawStyle = banner.getAttribute('style') ?? '';
		expect(rawStyle).toContain(SHELL_NAVBAR_HEIGHT);
		expect(rawStyle).toContain('safe-area-inset-bottom');
	});

	describe('token contract (AC3 — design tokens must not hard-code hex values)', () => {
		// AC3 requires design tokens to be applied globally. UpdatePrompt must use
		// token-backed Tailwind classes so it cannot drift from the shared color system.
		it('banner uses bg-primary token class (not hard-coded hex)', () => {
			render(UpdatePrompt);
			flushSync(() => capturedOnNeedRefresh?.());
			const banner = screen.getByRole('status');
			expect(banner.className).toContain('bg-primary');
			expect(banner.className).not.toContain('#2563');
		});

		it('banner uses text-primary-foreground token class (not hard-coded "text-white")', () => {
			render(UpdatePrompt);
			flushSync(() => capturedOnNeedRefresh?.());
			const banner = screen.getByRole('status');
			expect(banner.className).toContain('text-primary-foreground');
		});

		it('Reload button uses token classes: bg-primary-foreground, text-primary, rounded-lg', () => {
			render(UpdatePrompt);
			flushSync(() => capturedOnNeedRefresh?.());
			const button = screen.getByRole('button', { name: /reload/i });
			expect(button.className).toContain('bg-primary-foreground');
			expect(button.className).toContain('text-primary');
			expect(button.className).toContain('rounded-lg');
			// Ensure old hard-coded values are gone
			expect(button.className).not.toContain('bg-white');
			expect(button.className).not.toContain('rounded-md');
		});
	});
});
