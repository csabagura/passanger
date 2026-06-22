import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/svelte';
import Field from './field.svelte';

describe('Field', () => {
	afterEach(() => {
		cleanup();
	});

	it('associates the label with the input via for/id', () => {
		render(Field, { props: { label: 'Odometer' } });
		const input = screen.getByLabelText('Odometer');
		expect(input).toBeTruthy();
		const label = screen.getByText('Odometer');
		const inputId = input.getAttribute('id');
		expect(inputId).toBeTruthy();
		expect(label.getAttribute('for')).toBe(inputId);
	});

	it('renders no error region and no aria-invalid when there is no error', () => {
		render(Field, { props: { label: 'Quantity' } });
		const input = screen.getByLabelText('Quantity');
		expect(input.getAttribute('aria-invalid')).toBeNull();
		expect(input.getAttribute('aria-describedby')).toBeNull();
	});

	it('links the error via aria-describedby and toggles aria-invalid', () => {
		render(Field, { props: { label: 'Cost', error: 'Cost is required' } });
		const input = screen.getByLabelText('Cost');
		expect(input.getAttribute('aria-invalid')).toBe('true');

		const describedBy = input.getAttribute('aria-describedby');
		expect(describedBy).toBeTruthy();

		const errorEl = describedBy ? document.getElementById(describedBy) : null;
		expect(errorEl).toBeTruthy();
		expect(errorEl?.textContent).toBe('Cost is required');
	});

	it('generates unique ids for multiple fields on the same page', () => {
		render(Field, { props: { label: 'First' } });
		render(Field, { props: { label: 'Second' } });
		const a = screen.getByLabelText('First').getAttribute('id');
		const b = screen.getByLabelText('Second').getAttribute('id');
		expect(a).toBeTruthy();
		expect(b).toBeTruthy();
		expect(a).not.toBe(b);
	});

	it('announces the error via role="alert"', () => {
		render(Field, { props: { label: 'Cost', error: 'Cost is required' } });
		const alert = screen.getByRole('alert');
		expect(alert.textContent).toBe('Cost is required');
	});

	it('keeps the error wiring and merges a caller-supplied aria-describedby', () => {
		render(Field, {
			props: { label: 'Cost', error: 'Cost is required', 'aria-describedby': 'hint-1' }
		});
		const input = screen.getByLabelText('Cost');
		const errorId = `${input.getAttribute('id')}-error`;
		const describedBy = input.getAttribute('aria-describedby') ?? '';
		// Controlled error linkage survives the passthrough, and the caller hint is preserved too.
		expect(describedBy.split(' ')).toContain(errorId);
		expect(describedBy.split(' ')).toContain('hint-1');
		expect(input.getAttribute('aria-invalid')).toBe('true');
	});

	it('forwards type and round-trips the bound value', () => {
		render(Field, { props: { label: 'Quantity', type: 'number', value: 42 } });
		const input = screen.getByLabelText('Quantity') as HTMLInputElement;
		expect(input.getAttribute('type')).toBe('number');
		expect(input.value).toBe('42');
	});
});
