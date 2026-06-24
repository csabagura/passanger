<script module lang="ts">
	// A single normalized datum for an interactive chart. The PARENT formats `valueText` (via
	// formatCurrency / formatConsumption) and supplies `entryHref` only where the datum maps 1:1 to a
	// single entry (consumption points) — aggregate bars (monthly spend, maintenance trend) omit it.
	export interface ChartDatum {
		/** Date / month label, e.g. "March 2026" or "10 Mar". */
		label: string;
		/** Raw numeric value — used only for the chart geometry. */
		value: number;
		/** Pre-formatted display string (currency or consumption) — the authoritative value text. */
		valueText: string;
		/** Link to the underlying entry's home surface, when the datum is 1:1 with an entry. */
		entryHref?: string;
	}
</script>

<script lang="ts">
	// Story 4.4 (FR-13 / FR-17): the reusable hand-rolled interactive chart shared across the Understand
	// surface's bar + line charts (one component → NFR-4-friendly, no charting library). It renders the
	// chart geometry as an aria-hidden SVG (ported from the old analytics page) with an HTML overlay of
	// focusable <button>s — one per datum — keyed to the same geometry. Selecting a datum reveals its
	// exact value, label, and (where 1:1 with an entry) a "View entry" link. A "View as table" toggle
	// swaps the visual for a real semantic <table> — the MANDATED screen-reader-navigable representation
	// (the old single aria-label string was insufficient per the a11y floor).

	interface Props {
		title: string;
		points: ChartDatum[];
		kind: 'bar' | 'line';
		/** Short axis/unit hint shown under the heading (e.g. "Total per month in €"). */
		subtitle?: string;
		/** Sentence describing the whole series for the chart's accessible name. */
		ariaSummary: string;
		/** Copy shown when there are zero points. */
		emptyText: string;
		/** Optional hint shown beneath a single-point readout. */
		singlePointHint?: string;
		/** Stable id prefix for ARIA wiring (headings, table caption). */
		idBase: string;
	}

	let { title, points, kind, subtitle, ariaSummary, emptyText, singlePointHint, idBase }: Props =
		$props();

	// viewBox geometry — identical to the retired analytics page so the visual matches byte-for-byte.
	const CHART_WIDTH = 320;
	const CHART_HEIGHT = 180;
	const CHART_PADDING_X = 8;
	const CHART_TOP = 12;
	const CHART_BOTTOM = 28;

	const count = $derived(points.length);
	const maxValue = $derived(points.reduce((max, point) => Math.max(max, point.value), 0));
	const minValue = $derived(
		points.reduce((min, point) => Math.min(min, point.value), points[0]?.value ?? 0)
	);

	let selectedIndex = $state<number | null>(null);
	let asTable = $state(false);

	const selected = $derived(selectedIndex !== null ? (points[selectedIndex] ?? null) : null);

	// Reset transient UI when the underlying series changes shape (e.g. a new fill arrives via liveQuery).
	$effect(() => {
		if (selectedIndex !== null && selectedIndex >= points.length) {
			selectedIndex = null;
		}
	});

	function barGeometry(index: number): { x: number; width: number; y: number; height: number } {
		const innerWidth = CHART_WIDTH - CHART_PADDING_X * 2;
		const innerHeight = CHART_HEIGHT - CHART_TOP - CHART_BOTTOM;
		const slot = innerWidth / Math.max(count, 1);
		const width = Math.max(slot * 0.6, 1);
		const x = CHART_PADDING_X + slot * index + (slot - width) / 2;
		const value = points[index].value;
		const ratio = maxValue > 0 ? value / maxValue : 0;
		const height = Math.max(ratio * innerHeight, value > 0 ? 2 : 0);
		const y = CHART_TOP + (innerHeight - height);
		return { x, width, y, height };
	}

	function linePoint(index: number): { x: number; y: number } {
		const innerWidth = CHART_WIDTH - CHART_PADDING_X * 2;
		const innerHeight = CHART_HEIGHT - CHART_TOP - CHART_BOTTOM;
		const x = count > 1 ? CHART_PADDING_X + (innerWidth * index) / (count - 1) : CHART_WIDTH / 2;
		const span = maxValue - minValue;
		const ratio = span > 0 ? (points[index].value - minValue) / span : 0.5;
		const y = CHART_TOP + (innerHeight - ratio * innerHeight);
		return { x, y };
	}

	const linePath = $derived.by(() => {
		if (kind !== 'line' || count === 0) return '';
		return points
			.map((_, index) => {
				const { x, y } = linePoint(index);
				return `${index === 0 ? 'M' : 'L'}${x.toFixed(2)} ${y.toFixed(2)}`;
			})
			.join(' ');
	});

	const areaPath = $derived.by(() => {
		if (kind !== 'line' || count === 0) return '';
		const baseline = CHART_HEIGHT - CHART_BOTTOM;
		const first = linePoint(0);
		const last = linePoint(count - 1);
		return `${linePath} L${last.x.toFixed(2)} ${baseline} L${first.x.toFixed(2)} ${baseline} Z`;
	});

	// Convert SVG-space coords to container percentages. Because the SVG uses preserveAspectRatio="none",
	// its internal coordinate system maps linearly onto the container box, so the same percentages place
	// the HTML overlay buttons exactly over the bars/points regardless of the rendered size.
	function pct(value: number, span: number): number {
		return (value / span) * 100;
	}

	function select(index: number): void {
		selectedIndex = index;
	}

	const headingId = $derived(`${idBase}-title`);
</script>

<section
	aria-labelledby={headingId}
	class="space-y-3 rounded-3xl border border-border bg-card p-4 shadow-sm"
>
	<div class="flex items-start justify-between gap-3">
		<div class="space-y-1">
			<h2 id={headingId} class="text-base font-semibold text-foreground">{title}</h2>
			{#if subtitle}
				<p class="text-xs text-muted-foreground">{subtitle}</p>
			{/if}
		</div>
		{#if count >= 1}
			<button
				type="button"
				aria-pressed={asTable}
				onclick={() => (asTable = !asTable)}
				class="shrink-0 rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-card"
			>
				{asTable ? 'View as chart' : 'View as table'}
			</button>
		{/if}
	</div>

	{#if count === 0}
		<p class="py-6 text-center text-sm text-muted-foreground">{emptyText}</p>
	{:else if asTable}
		<!-- Mandated FR-17 representation: a real semantic table, navigable + announced without geometry. -->
		<table class="w-full border-collapse text-sm">
			<caption class="sr-only">{title}. {ariaSummary}</caption>
			<thead>
				<tr class="border-b border-border text-left text-xs text-muted-foreground">
					<th scope="col" class="py-1.5 pr-3 font-medium">Period</th>
					<th scope="col" class="py-1.5 pr-3 font-medium">Value</th>
					{#if points.some((point) => point.entryHref)}
						<th scope="col" class="py-1.5 font-medium">Entry</th>
					{/if}
				</tr>
			</thead>
			<tbody>
				{#each points as point, index (index)}
					<tr class="border-b border-border/50">
						<td class="py-1.5 pr-3 text-foreground">{point.label}</td>
						<td class="py-1.5 pr-3 tabular-nums text-foreground">{point.valueText}</td>
						{#if points.some((entry) => entry.entryHref)}
							<td class="py-1.5">
								{#if point.entryHref}
									<!-- eslint-disable svelte/no-navigation-without-resolve -- entryHref is supplied by the parent already passed through resolve(); ChartDatum carries a resolved app path. -->
									<a
										href={point.entryHref}
										class="text-accent underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
									>
										View entry
									</a>
									<!-- eslint-enable svelte/no-navigation-without-resolve -->
								{/if}
							</td>
						{/if}
					</tr>
				{/each}
			</tbody>
		</table>
	{:else if count === 1}
		<!-- Single data point shows the VALUE, never a degenerate line/area (FR-13). Where the datum is
		     1:1 with an entry, its "View entry" link is surfaced here too (AC4) — not only in table view. -->
		<div class="rounded-2xl bg-muted/40 px-4 py-6 text-center">
			<span class="block text-2xl font-bold tabular-nums text-foreground"
				>{points[0].valueText}</span
			>
			<span class="mt-1 block text-xs text-muted-foreground">{points[0].label}</span>
			{#if points[0].entryHref}
				<!-- eslint-disable svelte/no-navigation-without-resolve -- entryHref is supplied by the parent already passed through resolve(); ChartDatum carries a resolved app path. -->
				<a
					href={points[0].entryHref}
					class="mt-2 inline-block text-sm text-accent underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-card"
				>
					View entry
				</a>
				<!-- eslint-enable svelte/no-navigation-without-resolve -->
			{/if}
			{#if singlePointHint}
				<p class="mt-1 text-xs text-muted-foreground">{singlePointHint}</p>
			{/if}
		</div>
	{:else}
		<div class="relative h-44 w-full">
			<svg
				viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`}
				preserveAspectRatio="none"
				class="h-full w-full"
				aria-hidden="true"
			>
				<line
					x1={CHART_PADDING_X}
					y1={CHART_HEIGHT - CHART_BOTTOM}
					x2={CHART_WIDTH - CHART_PADDING_X}
					y2={CHART_HEIGHT - CHART_BOTTOM}
					class="stroke-border"
					stroke-width="1"
				/>
				{#if kind === 'bar'}
					{#each points as _, index (index)}
						{@const bar = barGeometry(index)}
						<rect
							x={bar.x}
							y={bar.y}
							width={bar.width}
							height={bar.height}
							rx="2"
							class={selectedIndex === index ? 'fill-foreground' : 'fill-accent'}
						/>
					{/each}
				{:else}
					<path d={areaPath} class="fill-accent/15" />
					<path
						d={linePath}
						fill="none"
						class="stroke-accent"
						stroke-width="2"
						stroke-linejoin="round"
						stroke-linecap="round"
						vector-effect="non-scaling-stroke"
					/>
				{/if}
			</svg>

			<!-- Focusable overlay: one <button> per datum, positioned by the same geometry. Each carries an
			     accessible name with the exact value; activating it reveals the detail readout below. -->
			<div class="absolute inset-0">
				{#each points as point, index (index)}
					{#if kind === 'bar'}
						{@const slotLeft = pct(
							CHART_PADDING_X + ((CHART_WIDTH - CHART_PADDING_X * 2) / count) * index,
							CHART_WIDTH
						)}
						{@const slotWidth = pct((CHART_WIDTH - CHART_PADDING_X * 2) / count, CHART_WIDTH)}
						<button
							type="button"
							onclick={() => select(index)}
							aria-label={`${point.label}: ${point.valueText}`}
							aria-pressed={selectedIndex === index}
							style={`left:${slotLeft}%;width:${slotWidth}%;top:${pct(CHART_TOP, CHART_HEIGHT)}%;height:${pct(CHART_HEIGHT - CHART_TOP - CHART_BOTTOM, CHART_HEIGHT)}%`}
							class="absolute rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-card"
						></button>
					{:else}
						{@const lp = linePoint(index)}
						<button
							type="button"
							onclick={() => select(index)}
							aria-label={`${point.label}: ${point.valueText}`}
							aria-pressed={selectedIndex === index}
							style={`left:${pct(lp.x, CHART_WIDTH)}%;top:${pct(lp.y, CHART_HEIGHT)}%`}
							class="absolute -translate-x-1/2 -translate-y-1/2 rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-card"
						>
							<span
								class="block h-3 w-3 rounded-full border-2 border-card {selectedIndex === index
									? 'bg-foreground'
									: 'bg-accent'}"
							></span>
							<span class="sr-only">{point.label}: {point.valueText}</span>
						</button>
					{/if}
				{/each}
			</div>
		</div>

		<!-- Shared detail readout (OQ-6): one polite live region per chart, updated on selection. -->
		<div role="status" aria-live="polite" class="min-h-[2.5rem] text-sm">
			{#if selected}
				<p class="text-foreground">
					<span class="font-medium">{selected.label}</span>:
					<span class="tabular-nums">{selected.valueText}</span>
					{#if selected.entryHref}
						·
						<!-- eslint-disable svelte/no-navigation-without-resolve -- entryHref is supplied by the parent already passed through resolve(); ChartDatum carries a resolved app path. -->
						<a
							href={selected.entryHref}
							class="text-accent underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
						>
							View entry
						</a>
						<!-- eslint-enable svelte/no-navigation-without-resolve -->
					{/if}
				</p>
			{:else}
				<p class="text-muted-foreground">Select a point to see its exact value.</p>
			{/if}
		</div>
	{/if}
</section>
