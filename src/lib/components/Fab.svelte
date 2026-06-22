<script lang="ts">
	import { getContext } from 'svelte';
	import Plus from '@lucide/svelte/icons/plus';
	import { Button } from '$lib/components/ui/button';
	import type { CaptureSheetContext } from '$lib/state/captureSheet.svelte';

	// The one persistent Capture entry (AD-3 / EXPERIENCE.md): a 56px floating circle that opens the
	// global Capture sheet from any surface. A fresh tap always defaults to Fuel (AC-1).
	const capture = getContext<CaptureSheetContext>('captureSheet');
</script>

<!--
	56px circle floating above the bottom nav. `size-14` overrides the icon size (size-11/44px) via
	tailwind-merge (later class wins). The shadow is intentional — DESIGN: the FAB is one of the only
	floating/shadowed surfaces. The bottom offset clears the 64px nav + safe-area inset.
-->
<Button
	size="icon"
	aria-label="Log a fill-up or expense"
	onclick={() => capture.openSheet('fuel')}
	class="fixed left-1/2 z-40 size-14 -translate-x-1/2 rounded-full shadow-lg"
	style="bottom: calc(64px + env(safe-area-inset-bottom) + 12px);"
>
	<Plus aria-hidden="true" />
</Button>
