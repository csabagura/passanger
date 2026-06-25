<script lang="ts">
	import { onDestroy } from 'svelte';
	import type { OnboardingSurveyResponse } from '$lib/utils/onboardingSurvey';
	import { m } from '$lib/paraglide/messages';

	interface Props {
		onSubmit: (response: OnboardingSurveyResponse) => void;
		onDismiss: () => void;
	}

	let { onSubmit, onDismiss }: Props = $props();

	const OPTIONS: { value: OnboardingSurveyResponse; label: string }[] = [
		{ value: 'track-costs', label: m.onboarding_reason_track_costs() },
		{ value: 'switching-app', label: m.onboarding_reason_switching_app() },
		{ value: 'multiple-vehicles', label: m.onboarding_reason_multiple_vehicles() },
		{ value: 'maintenance-reminders', label: m.onboarding_reason_maintenance_reminders() }
	];

	let selectedResponse = $state<OnboardingSurveyResponse | null>(null);
	let showMigrationHint = $state(false);
	let migrationTimer: ReturnType<typeof setTimeout> | null = null;

	onDestroy(() => {
		if (migrationTimer !== null) {
			clearTimeout(migrationTimer);
		}
	});

	function handleOptionKeydown(event: KeyboardEvent) {
		const currentIndex = selectedResponse
			? OPTIONS.findIndex((o) => o.value === selectedResponse)
			: -1;
		let nextIndex = -1;

		if (event.key === 'ArrowDown' || event.key === 'ArrowRight') {
			event.preventDefault();
			nextIndex = currentIndex < OPTIONS.length - 1 ? currentIndex + 1 : 0;
		} else if (event.key === 'ArrowUp' || event.key === 'ArrowLeft') {
			event.preventDefault();
			nextIndex = currentIndex > 0 ? currentIndex - 1 : OPTIONS.length - 1;
		}

		if (nextIndex >= 0) {
			selectedResponse = OPTIONS[nextIndex].value;
			const target = (event.currentTarget as HTMLElement).querySelectorAll<HTMLElement>(
				'[role="radio"]'
			)[nextIndex];
			target?.focus();
		}
	}

	function handleSubmit() {
		if (!selectedResponse) return;

		if (selectedResponse === 'switching-app') {
			showMigrationHint = true;
			migrationTimer = setTimeout(() => {
				migrationTimer = null;
				onSubmit(selectedResponse!);
			}, 3000);
		} else {
			onSubmit(selectedResponse);
		}
	}
</script>

{#if showMigrationHint}
	<section
		role="complementary"
		aria-label={m.onboarding_import_hint_landmark()}
		class="rounded-[1.5rem] border border-border/80 bg-card px-4 py-4 shadow-sm"
	>
		<div class="mx-auto mb-3 h-1.5 w-12 rounded-full bg-border/80"></div>
		<p class="text-sm text-foreground">
			{m.onboarding_import_hint_body()}
		</p>
	</section>
{:else}
	<section
		role="complementary"
		aria-label={m.onboarding_survey_landmark()}
		class="rounded-[1.5rem] border border-border/80 bg-card px-4 py-4 shadow-sm"
	>
		<div class="mx-auto mb-3 h-1.5 w-12 rounded-full bg-border/80"></div>

		<p class="text-sm font-semibold text-foreground">{m.onboarding_question()}</p>

		<!-- svelte-ignore a11y_interactive_supports_focus -->
		<div
			role="radiogroup"
			aria-label={m.onboarding_radiogroup_label()}
			class="mt-3 space-y-2"
			onkeydown={handleOptionKeydown}
		>
			{#each OPTIONS as option (option.value)}
				<button
					type="button"
					role="radio"
					aria-checked={selectedResponse === option.value}
					tabindex={selectedResponse === option.value ||
					(!selectedResponse && option.value === OPTIONS[0].value)
						? 0
						: -1}
					onclick={() => (selectedResponse = option.value)}
					class="flex w-full items-center gap-3 rounded-xl border px-4 py-3 text-left text-sm transition-colors {selectedResponse ===
					option.value
						? 'border-accent bg-accent/10 font-semibold text-accent'
						: 'border-border text-foreground hover:bg-muted/60'}"
				>
					<span
						class="flex h-4 w-4 shrink-0 items-center justify-center rounded-full border {selectedResponse ===
						option.value
							? 'border-accent'
							: 'border-muted-foreground'}"
						aria-hidden="true"
					>
						{#if selectedResponse === option.value}
							<span class="h-2 w-2 rounded-full bg-accent"></span>
						{/if}
					</span>
					<span>{option.label}</span>
				</button>
			{/each}
		</div>

		<div class="mt-4 flex flex-wrap items-center gap-3">
			<button
				type="button"
				disabled={!selectedResponse}
				onclick={handleSubmit}
				class="min-h-11 rounded-full bg-accent px-4 py-2 text-sm font-semibold text-accent-foreground hover:bg-accent/90 disabled:cursor-not-allowed disabled:opacity-70"
			>
				{m.onboarding_submit()}
			</button>
			<button
				type="button"
				onclick={onDismiss}
				class="min-h-11 rounded-full border border-border px-4 py-2 text-sm font-medium text-foreground hover:bg-muted"
			>
				{m.onboarding_skip()}
			</button>
		</div>
	</section>
{/if}
