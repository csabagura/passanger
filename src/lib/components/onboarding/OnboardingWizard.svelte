<script lang="ts">
	import { getContext, onDestroy } from 'svelte';
	import { saveVehicle } from '$lib/db/repositories/vehicles';
	import { saveServiceReminder } from '$lib/db/repositories/serviceReminders';
	import type { Vehicle } from '$lib/db/schema';
	import type { AppError } from '$lib/utils/result';
	import type { AppSettings } from '$lib/utils/settings';
	import { saveSettings } from '$lib/utils/settings';
	import { SUPPORTED_UNITS, PRESET_CURRENCIES, PRESET_REMINDERS } from '$lib/config';
	import type { FuelUnit } from '$lib/config';
	import { getDistanceUnitForFuelUnit } from '$lib/utils/calculations';
	import { Button } from '$lib/components/ui/button';
	import { Field } from '$lib/components/ui/field';
	import { m } from '$lib/paraglide/messages';

	// Story 9.1: guided add-a-car flow. Replaces the plain single-form first-run on Home. Reuses the
	// existing `saveVehicle` / `saveServiceReminder` / `saveSettings` write paths only — NO schema
	// change. Unit + currency are GLOBAL app settings (not per-vehicle); "starting odometer" has no
	// Vehicle field, so it is routed into seeded reminders' `lastServiceOdometer` anchor (never a new
	// `Vehicle.startingOdometer`). Rendered inline in the Home first-run slot (consistent with the
	// VehicleForm it replaces); a linear internal step model — not bits-ui Tabs, which is a
	// free-navigation tab switcher wrong for a gated wizard.

	interface Props {
		onComplete: (vehicle: Vehicle) => void;
		onCancel?: () => void;
	}
	let { onComplete, onCancel }: Props = $props();

	type AsyncState =
		| { status: 'idle' }
		| { status: 'loading' }
		| { status: 'error'; error: AppError };

	const settingsCtx = getContext<{
		readonly settings: AppSettings;
		updateSettings: (s: AppSettings) => void;
	}>('settings');

	const TOTAL_STEPS = 3;
	let step = $state<1 | 2 | 3>(1);

	// Step 1 — vehicle basics (mirrors VehicleForm's validation exactly).
	let displayName = $state('');
	let make = $state('');
	let model = $state('');
	let yearStr = $state('');
	let displayNameError = $state('');
	let makeError = $state('');
	let modelError = $state('');
	let yearError = $state('');
	const currentYear = new Date().getFullYear();

	// Step 2 — measurement + currency (pre-filled from current global settings).
	let measurement = $state<FuelUnit>(settingsCtx.settings.fuelUnit);
	let currency = $state<string>(settingsCtx.settings.currency);
	// Preset currencies plus the user's current one if it's a custom value not in the presets, so a
	// pre-existing custom currency stays selectable.
	const currencyOptions = $derived(
		PRESET_CURRENCIES.includes(currency as (typeof PRESET_CURRENCIES)[number])
			? [...PRESET_CURRENCIES]
			: [currency, ...PRESET_CURRENCIES]
	);

	// Step 3 — starting odometer + optional preset reminders.
	let odometerStr = $state('');
	let odometerError = $state('');
	let selectedPresets = $state<Record<string, boolean>>({});

	let commitState = $state<AsyncState>({ status: 'idle' });
	let toastMessage = $state('');
	let toastTimeout: ReturnType<typeof setTimeout> | null = null;

	function showToast(message: string) {
		toastMessage = message;
		if (toastTimeout) clearTimeout(toastTimeout);
		toastTimeout = setTimeout(() => {
			toastMessage = '';
			toastTimeout = null;
		}, 4000);
	}
	onDestroy(() => {
		if (toastTimeout) clearTimeout(toastTimeout);
	});

	function focusField(id: string): void {
		document.getElementById(id)?.focus();
	}

	function validateYear() {
		const trimmed = yearStr.trim();
		if (trimmed === '') {
			yearError = '';
			return;
		}
		if (!/^\d+$/.test(trimmed)) {
			yearError = m.vehicleform_error_year({ max: currentYear });
			return;
		}
		const n = parseInt(trimmed, 10);
		yearError = n >= 1900 && n <= currentYear ? '' : m.vehicleform_error_year({ max: currentYear });
	}

	function validateStep1(): boolean {
		displayNameError = displayName.trim() === '' ? m.vehicleform_error_name() : '';
		makeError = make.trim() === '' ? m.vehicleform_error_make() : '';
		modelError = model.trim() === '' ? m.vehicleform_error_model() : '';
		validateYear();
		if (displayNameError) focusField('onboarding-name');
		else if (makeError) focusField('onboarding-make');
		else if (modelError) focusField('onboarding-model');
		else if (yearError) focusField('onboarding-year');
		return !displayNameError && !makeError && !modelError && !yearError;
	}

	// Odometer is optional; when present it must be a positive finite number.
	function parseOdometer(): { ok: true; value?: number } | { ok: false } {
		const trimmed = odometerStr.trim();
		if (trimmed === '') return { ok: true, value: undefined };
		const n = Number(trimmed);
		if (!Number.isFinite(n) || n <= 0) {
			odometerError = m.onboarding_odometer_error();
			return { ok: false };
		}
		odometerError = '';
		return { ok: true, value: n };
	}

	function goNext() {
		if (step === 1 && !validateStep1()) return;
		if (step < TOTAL_STEPS) step = (step + 1) as 1 | 2 | 3;
	}
	function goBack() {
		if (step > 1) step = (step - 1) as 1 | 2 | 3;
	}

	function measurementLabel(unit: FuelUnit): string {
		return unit === 'MPG' ? m.onboarding_measurement_imperial() : m.onboarding_measurement_metric();
	}

	function presetTitle(key: string): string {
		switch (key) {
			case 'oil':
				return m.onboarding_preset_oil();
			case 'tires':
				return m.onboarding_preset_tires();
			case 'inspection':
				return m.onboarding_preset_inspection();
			default:
				return key;
		}
	}

	async function handleFinish() {
		if (commitState.status === 'loading') return;
		const odo = parseOdometer();
		if (!odo.ok) return;

		commitState = { status: 'loading' };

		// 1. Create the vehicle (the critical op — everything else is best-effort after it).
		const vres = await saveVehicle({
			name: displayName.trim(),
			make: make.trim(),
			model: model.trim(),
			year: yearStr.trim() !== '' ? parseInt(yearStr.trim(), 10) : undefined
		});
		if (vres.error) {
			commitState = { status: 'error', error: vres.error };
			showToast(
				vres.error.code === 'MAX_VEHICLES'
					? m.onboarding_error_max_vehicles()
					: m.onboarding_error_save()
			);
			return;
		}
		const vehicle = vres.data;

		// 2. Apply unit/currency to GLOBAL settings, only if the user changed them from current.
		const cur = settingsCtx.settings;
		if (measurement !== cur.fuelUnit || currency !== cur.currency) {
			const next: AppSettings = { ...cur, fuelUnit: measurement, currency };
			if (!saveSettings(next).error) settingsCtx.updateSettings(next);
			// A settings-write failure is non-fatal — the vehicle exists; defaults stand.
		}

		// 3. Seed the opt-in preset reminders. The starting odometer anchors each reminder's
		//    lastServiceOdometer (its only honest home — there is no Vehicle.odometer field).
		//    Best-effort: a failed seed must not block landing on a working Home.
		const distanceUnit = getDistanceUnitForFuelUnit(measurement);
		for (const preset of PRESET_REMINDERS) {
			if (!selectedPresets[preset.key]) continue;
			await saveServiceReminder({
				vehicleId: vehicle.id,
				title: presetTitle(preset.key),
				intervalKm: preset.intervalKm,
				intervalDays: preset.intervalDays,
				distanceUnit,
				lastServiceOdometer: odo.value
			});
		}

		onComplete(vehicle);
	}
</script>

{#if toastMessage}
	<div
		role="alert"
		class="fixed left-1/2 top-4 z-50 -translate-x-1/2 rounded-lg bg-destructive px-4 py-2 text-sm text-white shadow-md"
	>
		{toastMessage}
	</div>
{/if}

<section aria-label={m.onboarding_aria()} class="flex flex-col gap-4 p-4">
	<p class="text-meta text-muted-foreground">
		{m.onboarding_step_label({ current: step, total: TOTAL_STEPS })}
	</p>

	{#if step === 1}
		<h1 class="text-lg font-semibold text-foreground">{m.onboarding_step1_heading()}</h1>
		<Field
			id="onboarding-name"
			label={m.vehicleform_field_name()}
			type="text"
			bind:value={displayName}
			error={displayNameError}
			placeholder={m.vehicleform_placeholder_name()}
			oninput={() => {
				if (displayName.trim() !== '') displayNameError = '';
			}}
		/>
		<Field
			id="onboarding-make"
			label={m.vehicleform_field_make()}
			type="text"
			bind:value={make}
			error={makeError}
			placeholder={m.vehicleform_placeholder_make()}
			oninput={() => {
				if (make.trim() !== '') makeError = '';
			}}
		/>
		<Field
			id="onboarding-model"
			label={m.vehicleform_field_model()}
			type="text"
			bind:value={model}
			error={modelError}
			placeholder={m.vehicleform_placeholder_model()}
			oninput={() => {
				if (model.trim() !== '') modelError = '';
			}}
		/>
		<Field
			id="onboarding-year"
			label={m.vehicleform_field_year()}
			type="text"
			inputmode="numeric"
			pattern="[0-9]*"
			bind:value={yearStr}
			error={yearError}
			placeholder={m.vehicleform_placeholder_year()}
			onblur={validateYear}
		/>
	{:else if step === 2}
		<h1 class="text-lg font-semibold text-foreground">{m.onboarding_step2_heading()}</h1>

		<fieldset class="flex flex-col gap-2">
			<legend class="text-label text-muted-foreground uppercase"
				>{m.onboarding_measurement_label()}</legend
			>
			{#each SUPPORTED_UNITS as unit (unit)}
				<label class="flex min-h-11 items-center gap-3 rounded-md border border-input px-3">
					<input
						type="radio"
						name="onboarding-measurement"
						value={unit}
						checked={measurement === unit}
						onchange={() => (measurement = unit)}
						class="size-4"
					/>
					<span class="text-sm text-foreground">{measurementLabel(unit)}</span>
				</label>
			{/each}
		</fieldset>

		<div class="flex flex-col gap-2">
			<label for="onboarding-currency" class="text-label text-muted-foreground uppercase">
				{m.onboarding_currency_label()}
			</label>
			<select
				id="onboarding-currency"
				bind:value={currency}
				class="h-13 rounded-md border border-input bg-background px-3 text-base text-foreground"
			>
				{#each currencyOptions as option (option)}
					<option value={option}>{option}</option>
				{/each}
			</select>
		</div>
	{:else}
		<h1 class="text-lg font-semibold text-foreground">{m.onboarding_step3_heading()}</h1>
		<Field
			id="onboarding-odometer"
			label={m.onboarding_odometer_label()}
			type="text"
			inputmode="decimal"
			bind:value={odometerStr}
			error={odometerError}
			placeholder={m.onboarding_odometer_placeholder()}
			aria-describedby="onboarding-odometer-hint"
			oninput={() => {
				if (odometerStr.trim() === '') odometerError = '';
			}}
		/>
		<p id="onboarding-odometer-hint" class="text-meta text-muted-foreground">
			{m.onboarding_odometer_hint()}
		</p>

		<fieldset class="flex flex-col gap-2">
			<legend class="text-label text-muted-foreground uppercase"
				>{m.onboarding_reminders_heading()}</legend
			>
			<p class="text-meta text-muted-foreground">{m.onboarding_reminders_hint()}</p>
			{#each PRESET_REMINDERS as preset (preset.key)}
				<label class="flex min-h-11 items-center gap-3 rounded-md border border-input px-3">
					<input
						type="checkbox"
						checked={!!selectedPresets[preset.key]}
						onchange={(e) => (selectedPresets[preset.key] = e.currentTarget.checked)}
						class="size-4"
					/>
					<span class="text-sm text-foreground">{presetTitle(preset.key)}</span>
				</label>
			{/each}
		</fieldset>
	{/if}

	<div class="flex gap-3 pt-2">
		{#if step === 1}
			{#if onCancel}
				<Button variant="outline" onclick={onCancel}>{m.common_cancel()}</Button>
			{/if}
		{:else}
			<Button variant="outline" onclick={goBack}>{m.onboarding_back()}</Button>
		{/if}
		{#if step < TOTAL_STEPS}
			<Button size="lg" class="flex-1" onclick={goNext}>{m.onboarding_next()}</Button>
		{:else}
			<Button
				size="lg"
				class="flex-1"
				onclick={handleFinish}
				disabled={commitState.status === 'loading'}
				aria-busy={commitState.status === 'loading'}
			>
				{commitState.status === 'loading' ? m.form_saving() : m.onboarding_finish()}
			</Button>
		{/if}
	</div>
</section>
