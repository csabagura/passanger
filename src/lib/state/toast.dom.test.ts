import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/svelte';
import { toast as sonner } from 'svelte-sonner';
import { Toaster } from '$lib/components/ui/sonner';
import { toast } from './toast';

// (window.matchMedia is stubbed globally in src/test-setup.ts — sonner's Toaster calls it.)

// sonner is a global singleton portaling to document.body — clear toasts and unmount between
// tests so toasts never leak across cases.
afterEach(() => {
	sonner.dismiss();
	cleanup();
});

describe('toast channel — mounted Toaster (AC3/AC4)', () => {
	it('renders an action button that fires its onClick when clicked', async () => {
		render(Toaster);
		const onUndo = vi.fn();

		toast.action('Deleted', { label: 'Undo', onClick: onUndo });

		const button = await waitFor(() => {
			const match = Array.from(document.body.querySelectorAll('button')).find(
				(b) => b.textContent?.trim() === 'Undo'
			);
			if (!match) throw new Error('Undo button not rendered yet');
			return match;
		});

		expect(onUndo).not.toHaveBeenCalled();
		await fireEvent.click(button);
		expect(onUndo).toHaveBeenCalledTimes(1);
	});

	it('exposes an aria-live region so assistive tech announces toasts (AC4)', async () => {
		render(Toaster);

		// sonner renders the toaster container as a live region (a <section> with
		// aria-live="polite", always present); assert against what it actually emits, not an
		// assumed per-toast role="alert".
		const liveRegion = await waitFor(() => {
			const match = document.body.querySelector('section[aria-live]');
			if (!match) throw new Error('live region not rendered yet');
			return match;
		});

		expect(liveRegion).toBeTruthy();
		expect(liveRegion.getAttribute('aria-live')).toBe('polite');
	});

	it('error toasts announce assertively (AC4)', async () => {
		render(Toaster);
		toast.error('Save failed');

		// sonner sets each toast's own aria-live to "assertive" only when the toast is important
		// (Toast.svelte) — the wrapper marks errors important for exactly this.
		const toastEl = await waitFor(() => {
			const match = document.body.querySelector('[data-sonner-toast][aria-live]');
			if (!match) throw new Error('error toast not rendered yet');
			return match;
		});

		expect(toastEl.getAttribute('aria-live')).toBe('assertive');
	});
});
