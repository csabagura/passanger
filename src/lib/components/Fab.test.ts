import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';
import Fab from './Fab.svelte';
import type { CaptureSheetContext } from '$lib/state/captureSheet.svelte';

function renderFab() {
	const openSheet = vi.fn();
	const capture: CaptureSheetContext = {
		open: false,
		mode: 'fuel',
		prefill: null,
		openSheet,
		setMode: vi.fn(),
		close: vi.fn()
	};
	render(Fab, { context: new Map([['captureSheet', capture]]) });
	return { openSheet };
}

describe('Fab', () => {
	it('renders a button with an accessible name', () => {
		renderFab();
		const button = screen.getByRole('button', { name: /log a fill-up or expense/i });
		expect(button).toBeTruthy();
	});

	it('opens the Capture sheet on Fuel when tapped', async () => {
		const { openSheet } = renderFab();
		await fireEvent.click(screen.getByRole('button', { name: /log a fill-up or expense/i }));
		expect(openSheet).toHaveBeenCalledWith('fuel');
	});

	it('is the 56px floating circle (size-14 overrides the 44px icon size)', () => {
		renderFab();
		const button = screen.getByRole('button', { name: /log a fill-up or expense/i });
		expect(button.className).toContain('size-14');
		expect(button.className).toContain('rounded-full');
	});
});
