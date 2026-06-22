import { describe, it, expect, vi, afterEach } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import { flushSync } from 'svelte';
import CurrencyChips from './CurrencyChips.svelte';

afterEach(cleanup);

describe('CurrencyChips', () => {
	it('renders nothing when there are no recent currencies', () => {
		const { container } = render(CurrencyChips, {
			recent: [],
			selected: '€',
			onpick: vi.fn()
		});
		expect(container.querySelector('button')).toBeNull();
	});

	it('renders nothing when the only recent currency is the selected one', () => {
		const { container } = render(CurrencyChips, {
			recent: ['€'],
			selected: '€',
			onpick: vi.fn()
		});
		expect(container.querySelector('button')).toBeNull();
	});

	it('renders a chip for each recent currency except the selected one', () => {
		render(CurrencyChips, {
			recent: ['€', '$', '£'],
			selected: '€',
			onpick: vi.fn()
		});
		expect(screen.getByRole('button', { name: '$' })).toBeTruthy();
		expect(screen.getByRole('button', { name: '£' })).toBeTruthy();
		expect(screen.queryByRole('button', { name: '€' })).toBeNull();
	});

	it('calls onpick with the currency when a chip is tapped', async () => {
		const onpick = vi.fn();
		render(CurrencyChips, { recent: ['$', '£'], selected: '€', onpick });
		await fireEvent.click(screen.getByRole('button', { name: '£' }));
		flushSync();
		expect(onpick).toHaveBeenCalledWith('£');
	});

	it('uses type="button" so a chip never submits a surrounding form', () => {
		render(CurrencyChips, { recent: ['$'], selected: '€', onpick: vi.fn() });
		expect((screen.getByRole('button', { name: '$' }) as HTMLButtonElement).type).toBe('button');
	});
});
