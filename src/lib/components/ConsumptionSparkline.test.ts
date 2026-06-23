import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render } from '@testing-library/svelte';
import { flushSync } from 'svelte';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import ConsumptionSparkline from './ConsumptionSparkline.svelte';

// Story 2.4 (AC-3): the decorative consumption sparkline. Co-located unit tests for its render
// geometry + the reduced-motion contract. (Added during code review — the component shipped with no
// tests and Task 8(f)'s reduced-motion check was missing.) The SVG is aria-hidden / role=
// presentation, so it is queried via document.querySelector, never getByRole.

afterEach(() => {
	cleanup();
});

describe('ConsumptionSparkline', () => {
	it('renders nothing when there are no values', () => {
		render(ConsumptionSparkline, { props: { values: [] } });
		flushSync();
		expect(document.querySelector('svg')).toBeNull();
	});

	it('renders nothing when every value is non-finite', () => {
		render(ConsumptionSparkline, { props: { values: [NaN, Infinity, -Infinity] } });
		flushSync();
		expect(document.querySelector('svg')).toBeNull();
	});

	it('renders a single centred point with no line for one value', () => {
		render(ConsumptionSparkline, { props: { values: [7] } });
		flushSync();

		expect(document.querySelector('svg')).toBeTruthy();
		expect(document.querySelector('polyline')).toBeNull();

		const circles = document.querySelectorAll('circle');
		expect(circles.length).toBe(1);
		// Single point is horizontally centred (WIDTH / 2) and vertically centred (degenerate span).
		expect(circles[0].getAttribute('cx')).toBe('60');
		expect(circles[0].getAttribute('cy')).toBe('16');
	});

	it('draws a polyline plus a final point for two or more values, newest on the right', () => {
		render(ConsumptionSparkline, { props: { values: [6.5, 7.2] } });
		flushSync();

		const polyline = document.querySelector('polyline');
		expect(polyline).toBeTruthy();
		expect(polyline?.getAttribute('points')).not.toContain('NaN');

		// The final (newest) point sits at the right edge: PADDING + (n-1)*step = WIDTH - PADDING.
		expect(document.querySelector('circle')?.getAttribute('cx')).toBe('116');
	});

	it('centres a flat line for an all-identical series (no baseline pinning, no NaN)', () => {
		render(ConsumptionSparkline, { props: { values: [7, 7, 7] } });
		flushSync();

		const polyline = document.querySelector('polyline');
		expect(polyline?.getAttribute('points')).not.toContain('NaN');

		// Degenerate span → mid-height (PADDING + innerHeight / 2), not pinned to the bottom edge.
		expect(document.querySelector('circle')?.getAttribute('cy')).toBe('16');
	});

	it('filters non-finite values out of the geometry', () => {
		render(ConsumptionSparkline, { props: { values: [6.5, NaN, 7.2] } });
		flushSync();

		const polyline = document.querySelector('polyline');
		expect(polyline).toBeTruthy();
		expect(polyline?.getAttribute('points')).not.toContain('NaN');
		// NaN dropped → two finite points → the newest still sits at the right edge.
		expect(document.querySelector('circle')?.getAttribute('cx')).toBe('116');
	});

	it('renders the animated final point with its animation-hook class', () => {
		render(ConsumptionSparkline, { props: { values: [6.5, 7.2] } });
		flushSync();
		expect(document.querySelector('circle')?.getAttribute('class')).toContain('sparkline-point');
	});

	// AC-3 / NFR-3 reduced-motion contract. The behaviour is CSS-only (a `@media (prefers-reduced-
	// motion: reduce)` rule), which jsdom does not evaluate, and the e2e/axe sweep is fenced to Story
	// 6.3 — so this guards the rule structurally: reduced motion must disable the ANIMATION only and
	// must never touch `transform` (the bits-ui layout caveat). Catches a future edit/regen that
	// reintroduces a transform-killing rule under reduced motion.
	it('disables only the animation (never transform) under prefers-reduced-motion', () => {
		const source = readFileSync(
			join(process.cwd(), 'src/lib/components/ConsumptionSparkline.svelte'),
			'utf-8'
		);
		const reduceStart = source.indexOf('@media (prefers-reduced-motion: reduce)');
		const styleEnd = source.indexOf('</style>');
		expect(reduceStart).toBeGreaterThan(-1);

		const reduceBlock = source.slice(reduceStart, styleEnd);
		expect(reduceBlock).toContain('animation: none');
		expect(reduceBlock).not.toContain('transform');
		// And the base point actually has an animation to disable.
		expect(source).toContain('animation: sparkline-point-in');
	});
});
