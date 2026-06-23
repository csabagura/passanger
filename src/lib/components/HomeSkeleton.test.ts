import { describe, it, expect, afterEach } from 'vitest';
import { cleanup, render, screen } from '@testing-library/svelte';
import HomeSkeleton from './HomeSkeleton.svelte';

afterEach(() => cleanup());

describe('HomeSkeleton', () => {
	it('exposes a polite loading status for screen readers', () => {
		render(HomeSkeleton);
		const status = screen.getByRole('status');
		expect(status.textContent).toMatch(/loading your dashboard/i);
		expect(status.getAttribute('aria-live')).toBe('polite');
	});

	it('NFR-3: the pulse is gated on motion-safe so reduced-motion users get static blocks', () => {
		const { container } = render(HomeSkeleton);
		const pulsing = container.querySelectorAll('.motion-safe\\:animate-pulse');
		// One shaped block per glance element (summary, stat label + number, up-next title + body, recency).
		expect(pulsing.length).toBeGreaterThanOrEqual(4);
		// No unconditional animate-pulse (which would ignore prefers-reduced-motion).
		expect(container.querySelectorAll('.animate-pulse').length).toBe(0);
	});
});
