<script lang="ts">
	import { getContext } from 'svelte';
	import X from '@lucide/svelte/icons/x';
	import { getServiceRemindersForVehicle } from '$lib/db/repositories/serviceReminders';
	import {
		selectDueReminders,
		REMINDER_STATUS_PRESENTATION,
		type DueReminder
	} from '$lib/utils/serviceReminder';
	import {
		readDismissals,
		dismissReminder,
		clearDismissal,
		isSuppressedByDismissal
	} from '$lib/utils/reminderDismissal';
	import type { CaptureSheetContext } from '$lib/state/captureSheet.svelte';
	import { isFiniteNumber } from '$lib/utils/calculations';
	import { predictedDateView } from '$lib/utils/metrics/reminderPrediction';
	import { m } from '$lib/paraglide/messages';
	import type { FuelLog } from '$lib/db/schema';

	interface Props {
		vehicleId: number;
		// Fed by HomeDashboard's liveQuery so a new fuel Capture re-derives currentOdometer reactively
		// (AC6) without a refreshSignal. `today` is injectable for deterministic tests.
		fuelLogs: FuelLog[];
		today?: Date;
	}

	let { vehicleId, fuelLogs, today = new Date() }: Props = $props();

	// "Log this service" opens Capture(Expense) prefilled with the reminder title (AC2).
	const capture = getContext<CaptureSheetContext>('captureSheet');
	// Cross-tab / Settings reminder edits arrive via the tabSync `dataRevision` bump.
	const tabSyncCtx = getContext<{ dataRevision: number } | undefined>('tabSync');

	// `currentOdometer` = max odometer across the vehicle's fuel logs (same definition as Settings /
	// the retired RemindersDueCard). Derived from the prop, so a new fuel Capture updates it live.
	// PREP-1: a corrupt/legacy non-finite odometer is dropped (not fed into Math.max, where a single
	// NaN would poison the whole reduce → NaN currentOdometer → corrupt dismissal-window math). When
	// no log has a usable odometer, currentOdometer is undefined (the "unknown" case downstream).
	const currentOdometer = $derived.by(() => {
		const usable = fuelLogs.map((log) => log.odometer).filter(isFiniteNumber);
		return usable.length === 0 ? undefined : Math.max(...usable);
	});

	let dueReminders = $state<DueReminder[]>([]);
	// Distinguishes "not loaded yet" from "loaded, nothing due" so the loop-cleanup below never prunes
	// a freshly-saved dismissal against the initial empty `dueReminders` (before the async read lands).
	let loaded = $state(false);

	$effect(() => {
		// Reactive deps: active vehicle, cross-tab data revision, AND currentOdometer (read synchronously
		// below). currentOdometer being a top-level dep is intentional and load-bearing for AC6:
		// selectDueReminders computes each reminder's status FROM the odometer, so a new fuel Capture that
		// bumps currentOdometer must re-run this read to recompute due-soon/overdue. Do NOT move the read
		// into the async body to "avoid a DB re-read" — that drops it as a dep and leaves km-reminder
		// statuses stale (silent AC6 regression).
		const id = vehicleId;
		void tabSyncCtx?.dataRevision;
		const odometer = currentOdometer;
		const when = today;

		// `cancelled` guards against out-of-order resolution on a rapid vehicle switch / dataRevision
		// bump — IndexedDB read latency is unordered, so a stale load could clobber fresh data. Mirrors
		// the proven RemindersDueCard pattern.
		let cancelled = false;
		(async () => {
			const remindersResult = await getServiceRemindersForVehicle(id);
			if (cancelled) return;
			if (remindersResult.error) {
				// Silent: the card simply doesn't render; never crash the dashboard.
				dueReminders = [];
				loaded = true;
				return;
			}
			dueReminders = selectDueReminders(remindersResult.data, odometer, when);
			loaded = true;
		})();

		return () => {
			cancelled = true;
		};
	});

	// localStorage writes aren't reactive — bump this after a dismiss so the `visible` derivation
	// re-reads the map and re-filters synchronously (hiding the card, revealing the next-most-urgent).
	let dismissVersion = $state(0);

	// Most-urgent non-suppressed reminder. selectDueReminders already orders overdue-first then
	// due-soon (stable within group), so `find` returns the most-urgent that isn't dismissed (AC1).
	const visible = $derived.by(() => {
		void dismissVersion;
		const map = readDismissals();
		return (
			dueReminders.find(
				(d) => !isSuppressedByDismissal(d.reminder.id, d.status.status, currentOdometer, map)
			) ?? null
		);
	});

	// Loop-cleanup (AC3 hygiene): prune dismissal markers whose reminder is no longer due (returned to
	// `ok` or was deleted) so stale markers don't accumulate. Read-only of the due set; safe + cheap.
	$effect(() => {
		void dismissVersion;
		// Wait for the first load — pruning against the initial empty set would wipe a fresh dismissal.
		if (!loaded) return;
		const dueIds = new Set(dueReminders.map((d) => d.reminder.id));
		const map = readDismissals();
		for (const key of Object.keys(map)) {
			const id = Number(key);
			if (!dueIds.has(id)) {
				clearDismissal(id);
			}
		}
	});

	function handleLogService() {
		if (!visible) return;
		capture.openSheet('expense', { expenseType: visible.reminder.title });
	}

	function handleDismiss() {
		if (!visible) return;
		dismissReminder(visible.reminder.id, visible.status.status, currentOdometer);
		dismissVersion++;
	}
</script>

{#if visible}
	{@const status = visible.status.status}
	{@const presentation = REMINDER_STATUS_PRESENTATION[status]}
	{@const dateView = predictedDateView(visible.reminder, fuelLogs, currentOdometer, today)}
	<section
		aria-labelledby="up-next-card-heading"
		class="mb-4 flex gap-3 overflow-hidden rounded-xl border border-border bg-card p-4"
	>
		<!-- Left accent bar colored by status (DEC-15 tokens — no hardcoded hex). Decorative: status is
		     also conveyed as text below, so it is hidden from the a11y tree. -->
		<span
			aria-hidden="true"
			class="-my-4 -ml-4 w-1.5 shrink-0 {status === 'overdue'
				? 'bg-destructive'
				: 'bg-due-soon-accent'}"
		></span>
		<div class="min-w-0 flex-1">
			<h2 id="up-next-card-heading" class="text-label text-muted-foreground uppercase">
				{m.upnext_heading()}
			</h2>
			<p class="mt-1 truncate font-medium text-foreground">{visible.reminder.title}</p>
			<p class="text-sm {status === 'overdue' ? 'text-destructive' : 'text-due-soon'}">
				<!-- Short status word (text, not color-only — AC7) + remaining distance/time label. -->
				{presentation.label} · {visible.status.label}
			</p>
			{#if dateView.kind !== 'none'}
				<!-- Predicted service date (FR-10/FR-12) — an ADDITIONAL line under the remaining-distance
				     line, never replacing it. A sufficient cadence shows the "≈ due …" estimate; an
				     insufficient one shows the honest note instead of a guess (AC4). -->
				<p class="mt-0.5 text-sm text-muted-foreground">{dateView.text}</p>
			{/if}
			<button
				type="button"
				onclick={handleLogService}
				class="mt-3 inline-flex min-h-11 items-center rounded-lg bg-accent px-4 text-sm font-semibold text-accent-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
			>
				{m.upnext_log_service()}
			</button>
		</div>
		<button
			type="button"
			onclick={handleDismiss}
			aria-label={m.upnext_dismiss_aria({ title: visible.reminder.title })}
			class="-mt-1 -mr-1 inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
		>
			<X aria-hidden="true" class="h-5 w-5" />
		</button>
	</section>
{/if}
