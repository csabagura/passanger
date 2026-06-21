<script lang="ts">
	import { getContext } from 'svelte';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { getServiceRemindersForVehicle } from '$lib/db/repositories/serviceReminders';
	import { getAllFuelLogs } from '$lib/db/repositories/fuelLogs';
	import {
		selectDueReminders,
		REMINDER_STATUS_PRESENTATION,
		type DueReminder
	} from '$lib/utils/serviceReminder';

	interface Props {
		vehicleId: number;
		today?: Date;
		// Bumped by /log on a same-tab fuel save (BroadcastChannel does not self-notify),
		// so a newly-due km reminder appears without a manual reload.
		refreshSignal?: number;
	}

	let { vehicleId, today = new Date(), refreshSignal = 0 }: Props = $props();

	// Cross-tab / Settings edits arrive via the tabSync `dataRevision` bump.
	const tabSyncCtx = getContext<{ dataRevision: number } | undefined>('tabSync');

	let dueReminders = $state<DueReminder[]>([]);

	$effect(() => {
		// Reactive deps: active vehicle, same-tab fuel-save signal, cross-tab data revision.
		const id = vehicleId;
		void refreshSignal;
		void tabSyncCtx?.dataRevision;

		// `cancelled` guards against out-of-order resolution: a rapid vehicle switch (or
		// refresh-signal/dataRevision bump) re-runs this effect, and IndexedDB read latency
		// is unordered, so a stale load could otherwise clobber fresh data (e.g. show the
		// previous vehicle's reminders). Mirrors the pattern in settings/+page.svelte.
		let cancelled = false;
		(async () => {
			const remindersResult = await getServiceRemindersForVehicle(id);
			if (cancelled) return;
			if (remindersResult.error) {
				// Silent: the card simply doesn't render; never crash the dashboard.
				dueReminders = [];
				return;
			}

			// `currentOdometer` = max odometer across the vehicle's fuel logs (same as Settings).
			const logsResult = await getAllFuelLogs(id);
			if (cancelled) return;
			const currentOdometer =
				logsResult.error || logsResult.data.length === 0
					? undefined
					: logsResult.data.reduce((max, log) => Math.max(max, log.odometer), 0);

			dueReminders = selectDueReminders(remindersResult.data, currentOdometer, today);
		})();

		return () => {
			cancelled = true;
		};
	});

	function handleRowClick() {
		// resolve() handles the base path; the trailing #hash deep-links to the existing
		// reminders section heading. The lint rule only recognizes a bare resolve() arg, so the
		// concatenation is disabled here — the navigable path itself is still resolved.
		// eslint-disable-next-line svelte/no-navigation-without-resolve -- base path resolved; suffix is a static in-page fragment
		goto(`${resolve('/settings')}#settings-reminders-heading`);
	}
</script>

{#if dueReminders.length > 0}
	<section
		aria-labelledby="reminders-due-card-heading"
		class="mb-4 rounded-xl border border-border bg-card p-4"
	>
		<h2 id="reminders-due-card-heading" class="text-sm font-semibold text-foreground">
			Maintenance due
		</h2>
		<ul class="mt-3 space-y-2" aria-label="Due reminders">
			{#each dueReminders as { reminder, status } (reminder.id)}
				{@const presentation = REMINDER_STATUS_PRESENTATION[status.status]}
				<li>
					<button
						type="button"
						onclick={handleRowClick}
						class="flex min-h-11 w-full items-center justify-between gap-2 rounded-lg border border-border px-3 py-2 text-left"
					>
						<span class="min-w-0 flex-1">
							<span class="block truncate font-medium text-foreground">{reminder.title}</span>
							<span class="block text-xs text-muted-foreground">{status.label}</span>
						</span>
						<span
							class="inline-flex shrink-0 items-center rounded-full border px-2 py-0.5 text-xs font-medium {presentation.badge}"
						>
							{presentation.label}
						</span>
					</button>
				</li>
			{/each}
		</ul>
	</section>
{/if}
