<script lang="ts">
	// Story 3.3 (AC-4): content-shaped cold-load placeholder for Home. Hand-rolled `animate-pulse`
	// token blocks shaped like the three glance blocks (summary line · base cost stat · Up-Next slot)
	// — deliberately NOT a shadcn `skeleton` primitive: adding one pulls bits-ui surface and risks the
	// ~17 KB NFR-4 gzipped headroom (see Story 3.3 Dev Notes; precache-manifest.test.ts budget gate).
	//
	// Reduced-motion (NFR-3): `motion-safe:animate-pulse` so the pulse only runs when the user has NOT
	// asked for reduced motion; otherwise the blocks render as calm static placeholders.
	//
	// aria-hidden + a polite "Loading…" status sibling: the shapes are decorative, the status text is
	// the accessible equivalent for screen readers (which would otherwise read nothing meaningful).
</script>

<div class="px-4 pt-4">
	<p class="sr-only" role="status" aria-live="polite">Loading your dashboard…</p>
	<div aria-hidden="true" class="space-y-4">
		<!-- summary line -->
		<div class="h-5 w-3/4 rounded-md bg-muted motion-safe:animate-pulse"></div>

		<!-- base cost stat: a label line over a large number block -->
		<div class="rounded-xl border border-border bg-card p-4">
			<div class="h-3 w-24 rounded bg-muted motion-safe:animate-pulse"></div>
			<div class="mt-3 h-9 w-40 rounded-md bg-muted motion-safe:animate-pulse"></div>
		</div>

		<!-- Up-Next slot -->
		<div class="rounded-xl border border-border bg-card p-4">
			<div class="h-4 w-32 rounded bg-muted motion-safe:animate-pulse"></div>
			<div class="mt-3 h-10 w-full rounded-lg bg-muted motion-safe:animate-pulse"></div>
		</div>

		<!-- recency line (below the fold) -->
		<div class="h-4 w-1/2 rounded bg-muted motion-safe:animate-pulse"></div>
	</div>
</div>
