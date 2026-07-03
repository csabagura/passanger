import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/svelte';
import { createRawSnippet } from 'svelte';
import DbErrorCard from './DbErrorCard.svelte';

vi.mock('$app/paths', () => ({
	resolve: (path: string) => path
}));

describe('DbErrorCard', () => {
	it('renders title, body, and export CTA linking to /export', () => {
		render(DbErrorCard, {
			props: { title: 'Something went wrong', body: 'Your data is safe.', ctaLabel: 'Export data' }
		});

		expect(screen.getByText('Something went wrong')).toBeTruthy();
		expect(screen.getByText('Your data is safe.')).toBeTruthy();
		const cta = screen.getByRole('link', { name: 'Export data' });
		expect(cta.getAttribute('href')).toBe('/export');
	});

	it('renders as an alert region for assistive tech', () => {
		render(DbErrorCard, {
			props: { title: 'Title', body: 'Body', ctaLabel: 'CTA' }
		});
		expect(screen.getByRole('alert')).toBeTruthy();
	});

	it('renders a Snippet body with multiple paragraphs (History extra export hint)', () => {
		const body = createRawSnippet(() => ({
			render: () => '<div><p>First line.</p><p>Second hint line.</p></div>'
		}));
		const { container } = render(DbErrorCard, {
			props: { title: 'Title', body, ctaLabel: 'CTA' }
		});
		const paragraphs = Array.from(container.querySelectorAll('p')).map((p) => p.textContent);
		expect(paragraphs).toContain('First line.');
		expect(paragraphs).toContain('Second hint line.');
	});
});
