import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';
import ImportStepSource from './ImportStepSource.svelte';

describe('ImportStepSource', () => {
	it('renders four source option cards', () => {
		const onSourceSelected = vi.fn();
		render(ImportStepSource, { props: { onSourceSelected } });

		expect(screen.getByRole('button', { name: /fuelly/i })).toBeTruthy();
		expect(screen.getByRole('button', { name: /acar/i })).toBeTruthy();
		expect(screen.getByRole('button', { name: /drivvo/i })).toBeTruthy();
		expect(screen.getByRole('button', { name: /generic csv/i })).toBeTruthy();
	});

	it('calls onSourceSelected with "fuelly" when Fuelly card is clicked', async () => {
		const onSourceSelected = vi.fn();
		render(ImportStepSource, { props: { onSourceSelected } });

		await fireEvent.click(screen.getByRole('button', { name: /fuelly/i }));
		expect(onSourceSelected).toHaveBeenCalledWith('fuelly');
	});

	it('calls onSourceSelected with "acar" when aCar card is clicked', async () => {
		const onSourceSelected = vi.fn();
		render(ImportStepSource, { props: { onSourceSelected } });

		await fireEvent.click(screen.getByRole('button', { name: /acar/i }));
		expect(onSourceSelected).toHaveBeenCalledWith('acar');
	});

	it('calls onSourceSelected with "drivvo" when Drivvo card is clicked', async () => {
		const onSourceSelected = vi.fn();
		render(ImportStepSource, { props: { onSourceSelected } });

		await fireEvent.click(screen.getByRole('button', { name: /drivvo/i }));
		expect(onSourceSelected).toHaveBeenCalledWith('drivvo');
	});

	it('calls onSourceSelected with "generic" when Generic CSV card is clicked', async () => {
		const onSourceSelected = vi.fn();
		render(ImportStepSource, { props: { onSourceSelected } });

		await fireEvent.click(screen.getByRole('button', { name: /generic csv/i }));
		expect(onSourceSelected).toHaveBeenCalledWith('generic');
	});

	it('renders cards as buttons with aria-label', () => {
		const onSourceSelected = vi.fn();
		render(ImportStepSource, { props: { onSourceSelected } });

		const buttons = screen.getAllByRole('button');
		expect(buttons).toHaveLength(4);
		buttons.forEach((btn) => {
			expect(btn.getAttribute('aria-label')).toBeTruthy();
		});
	});
});
