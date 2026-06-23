<script lang="ts">
	// Story 2.4 (AC-3): a self-contained, decorative consumption sparkline rendered inside the
	// value-revealing save confirmation. The just-saved fill is the FINAL point, which animates in
	// (the one signature animation in the app). Data comes from `consumptionTrend()` in the caller —
	// this component only renders a minimal local SVG polyline, so it needs no Home/Understand
	// surface. SEAM: Story 4.2 can reuse this same component (or its point-in animation) when it
	// plays the new point onto the Home Hero trend.
	//
	// Decorative only: marked aria-hidden by the caller — the accessible equivalent is the calm
	// status text in the confirmation's live region.

	interface Props {
		// Consumption values in display units, ordered OLDEST → NEWEST (as `consumptionTrend` returns).
		values: number[];
	}

	let { values }: Props = $props();

	const WIDTH = 120;
	const HEIGHT = 32;
	const PADDING = 4;

	const points = $derived.by(() => {
		// Defensive: drop any non-finite values (NaN / ±Infinity) before computing geometry, so one
		// bad upstream point can't collapse the whole polyline to `NaN,NaN`.
		const finite = values.filter((value) => Number.isFinite(value));
		if (finite.length === 0) {
			return [] as { x: number; y: number }[];
		}
		const min = Math.min(...finite);
		const max = Math.max(...finite);
		const span = max - min;
		const innerWidth = WIDTH - PADDING * 2;
		const innerHeight = HEIGHT - PADDING * 2;
		const step = finite.length > 1 ? innerWidth / (finite.length - 1) : 0;
		return finite.map((value, index) => ({
			x: finite.length > 1 ? PADDING + index * step : WIDTH / 2,
			// Lower consumption (more efficient) sits higher; an all-equal series (span 0) centres
			// vertically instead of pinning every point to the baseline.
			y:
				span === 0
					? PADDING + innerHeight / 2
					: PADDING + innerHeight - ((value - min) / span) * innerHeight
		}));
	});

	const linePoints = $derived(points.map((point) => `${point.x},${point.y}`).join(' '));
	const lastPoint = $derived(points.length > 0 ? points[points.length - 1] : null);
</script>

{#if lastPoint}
	<svg
		viewBox="0 0 {WIDTH} {HEIGHT}"
		width={WIDTH}
		height={HEIGHT}
		role="presentation"
		aria-hidden="true"
		class="overflow-visible"
	>
		{#if points.length > 1}
			<polyline
				points={linePoints}
				fill="none"
				stroke="currentColor"
				stroke-width="1.5"
				stroke-linecap="round"
				stroke-linejoin="round"
				opacity="0.55"
			/>
		{/if}
		<circle
			class="sparkline-point"
			cx={lastPoint.x}
			cy={lastPoint.y}
			r="2.75"
			fill="currentColor"
		/>
	</svg>
{/if}

<style>
	/* AC-3: the new (final) point animates in — the one signature animation. Scoped keyframes; Svelte
	   namespaces the animation so it can't collide. */
	.sparkline-point {
		transform-box: fill-box;
		transform-origin: center;
		animation: sparkline-point-in 360ms ease-out;
	}

	@keyframes sparkline-point-in {
		from {
			opacity: 0;
			transform: scale(0.2);
		}
		to {
			opacity: 1;
			transform: scale(1);
		}
	}

	/* NFR-3: reduced motion degrades to an INSTANT state change — disable only the animation, never
	   `transform` (mirrors app.css L195-212; the bits-ui layout caveat). With the animation off the
	   point renders at its resting state (opacity 1, scale 1). */
	@media (prefers-reduced-motion: reduce) {
		.sparkline-point {
			animation: none;
		}
	}
</style>
