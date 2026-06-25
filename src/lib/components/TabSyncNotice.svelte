<script lang="ts">
	import { m } from '$lib/paraglide/messages';

	interface Props {
		// Subtle, auto-dismissing cue for an ordinary remote change (null = hidden). The layout owns
		// the dismiss timer so repeated messages reset it.
		cue: 'data' | 'settings' | null;
		// A backup restore in another tab replaced the whole DB — show a prominent persistent prompt.
		restorePending: boolean;
		onReload: () => void;
	}

	let { cue, restorePending, onReload }: Props = $props();
</script>

<!--
	Cross-tab reconciliation notice. Two mutually-exclusive states, restore taking precedence:
	- restorePending: prominent persistent banner (role="alert") — the only action is Reload, because
	  this tab's in-memory rows reference a DB that no longer exists. We never silently swap the view.
	- cue: subtle polite status pill for an ordinary remote change (data already refreshed underneath).
	No modals / focus traps — consistent with the app's inline-notice convention.
-->
{#if restorePending}
	<div class="fixed inset-x-0 top-0 z-50 px-4 pt-[env(safe-area-inset-top,0px)]" role="alert">
		<div
			class="mx-auto mt-2 flex w-full max-w-[480px] items-start justify-between gap-3 rounded-xl border border-primary bg-card px-4 py-3 text-sm shadow-lg"
		>
			<p class="leading-snug text-foreground">
				{m.tabsync_restore_replaced()}
			</p>
			<button
				class="shrink-0 rounded-lg bg-primary px-3 py-1 text-xs font-semibold text-primary-foreground hover:opacity-90"
				onclick={onReload}
			>
				{m.common_reload()}
			</button>
		</div>
	</div>
{:else if cue}
	<div
		class="pointer-events-none fixed inset-x-0 top-0 z-40 flex justify-center px-4 pt-[env(safe-area-inset-top,0px)]"
		role="status"
		aria-live="polite"
	>
		<p
			class="mt-2 rounded-full border border-border bg-muted px-3 py-1 text-xs font-medium text-muted-foreground shadow-sm"
		>
			{m.tabsync_updated_in_another_tab()}
		</p>
	</div>
{/if}
