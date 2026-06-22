<script lang="ts">
	import * as Tabs from '$lib/components/ui/tabs';
</script>

<!--
	The AD-1 "Tabs→SegmentedControl": a filled-pill Fuel|Expense control built on the generated ui/tabs
	primitive. Renders INSIDE CaptureSheet's <Tabs.Root>, so it reads the Tabs context and bits-ui gives
	roving-tabindex arrow-key nav + tablist/tab ARIA for free.

	⚠️ tabs-list.svelte hard-codes `group-data-horizontal/tabs:h-8` (32px) on the List, which would clamp
	the triggers below the 44px touch target (AC-4). Override the List to `h-auto` so the min-h-[44px]
	triggers render at full height. The triggers are flex-1 so the two segments split the width evenly.
-->
<Tabs.List variant="default" class="h-auto w-full">
	<Tabs.Trigger value="fuel" class="min-h-[44px] flex-1">Fuel</Tabs.Trigger>
	<Tabs.Trigger value="expense" class="min-h-[44px] flex-1">Expense</Tabs.Trigger>
</Tabs.List>
