<script lang="ts">
	import { getContext } from 'svelte';
	import { PRESET_CURRENCIES, SUPPORTED_UNITS } from '$lib/config';
	import { saveSettings, type AppSettings, type ThemePreference } from '$lib/utils/settings';
	import { readStoredVehicleId } from '$lib/utils/vehicleStorage';
	import VehicleListManager from '$lib/components/VehicleListManager.svelte';

	let activeVehicleId = $state<number | null>(readStoredVehicleId());

	function handleActiveVehicleChange(id: number | null) {
		activeVehicleId = id;
	}

	const THEME_OPTIONS: { value: ThemePreference; label: string; description: string }[] = [
		{ value: 'system', label: 'System', description: 'Follows your device setting' },
		{ value: 'light', label: 'Light', description: 'Always light' },
		{ value: 'dark', label: 'Dark', description: 'Always dark' }
	];

	let settingsFuelUnit = $state<AppSettings['fuelUnit']>('L/100km');
	let settingsCurrency = $state('');
	let currencyError = $state('');
	let settingsStatusMessage = $state('');
	let settingsErrorMessage = $state('');
	let initialized = $state(false);

	const settingsCtx = getContext<{
		settings: AppSettings;
		updateSettings: (settings: AppSettings) => void;
	}>('settings');

	const fuelUnitHelpId = 'settings-fuel-unit-help';
	const currencyHelpId = 'settings-currency-help';
	const currencyErrorId = 'settings-currency-error';

	$effect(() => {
		if (!initialized) {
			settingsFuelUnit = settingsCtx.settings.fuelUnit;
			settingsCurrency = settingsCtx.settings.currency;
			initialized = true;
		}
	});

	function handleThemeChange(theme: ThemePreference): void {
		const nextSettings: AppSettings = {
			...settingsCtx.settings,
			theme
		};

		if (!saveSettings(nextSettings)) {
			return;
		}

		settingsCtx.updateSettings(nextSettings);
	}

	function handlePresetCurrencySelect(presetCurrency: string): void {
		settingsCurrency = presetCurrency;
		currencyError = '';
		settingsStatusMessage = '';
		settingsErrorMessage = '';
	}

	function handleCurrencyInput(): void {
		currencyError = '';
		settingsStatusMessage = '';
		settingsErrorMessage = '';
	}

	function handleSettingsSubmit(event: SubmitEvent): void {
		event.preventDefault();

		if (settingsCurrency.trim().length === 0) {
			currencyError = 'Enter a currency symbol or prefix.';
			settingsStatusMessage = '';
			settingsErrorMessage = '';
			return;
		}

		const nextSettings: AppSettings = {
			fuelUnit: settingsFuelUnit,
			currency: settingsCurrency,
			theme: settingsCtx.settings.theme
		};

		currencyError = '';
		settingsStatusMessage = '';
		settingsErrorMessage = '';

		if (!saveSettings(nextSettings)) {
			settingsErrorMessage =
				'Could not save settings on this device. Allow storage access and try again.';
			return;
		}

		settingsCtx.updateSettings(nextSettings);
		settingsStatusMessage = 'Settings saved.';
	}
</script>

<svelte:head>
	<title>Settings | passanger</title>
</svelte:head>

<div class="space-y-6 px-4 pt-4">
	<section
		aria-labelledby="settings-appearance-heading"
		class="space-y-5 rounded-2xl border border-border bg-card p-5 shadow-sm"
	>
		<div class="space-y-1">
			<h2 id="settings-appearance-heading" class="text-lg font-semibold text-foreground">
				Appearance
			</h2>
			<p class="text-sm text-muted-foreground">Choose how passanger looks</p>
		</div>

		<!-- svelte-ignore a11y_interactive_supports_focus -->
		<div
			role="radiogroup"
			aria-label="Theme"
			class="grid grid-cols-3 gap-2"
			onkeydown={(e: KeyboardEvent) => {
				const currentIndex = THEME_OPTIONS.findIndex(
					(o) => o.value === settingsCtx.settings.theme
				);
				let nextIndex = -1;
				if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
					nextIndex = (currentIndex + 1) % THEME_OPTIONS.length;
				} else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
					nextIndex = (currentIndex - 1 + THEME_OPTIONS.length) % THEME_OPTIONS.length;
				}
				if (nextIndex >= 0) {
					e.preventDefault();
					handleThemeChange(THEME_OPTIONS[nextIndex].value);
					const target = (e.currentTarget as HTMLElement).querySelectorAll<HTMLElement>(
						'[role="radio"]'
					)[nextIndex];
					target?.focus();
				}
			}}
		>
			{#each THEME_OPTIONS as option (option.value)}
				<button
					type="button"
					role="radio"
					aria-checked={settingsCtx.settings.theme === option.value}
					tabindex={settingsCtx.settings.theme === option.value ? 0 : -1}
					onclick={() => handleThemeChange(option.value)}
					class="flex flex-col items-center gap-1 rounded-xl border px-3 py-3 text-sm transition-colors {settingsCtx
						.settings.theme === option.value
						? 'border-accent bg-accent/10 font-semibold text-accent'
						: 'border-border text-foreground hover:bg-muted/60'}"
				>
					<span class="font-medium">{option.label}</span>
					<span
						class="text-xs {settingsCtx.settings.theme === option.value
							? 'text-accent/80'
							: 'text-muted-foreground'}">{option.description}</span
					>
				</button>
			{/each}
		</div>
	</section>

	<section
		aria-labelledby="settings-vehicles-heading"
		class="space-y-5 rounded-2xl border border-border bg-card p-5 shadow-sm"
	>
		<div class="space-y-1">
			<h2 id="settings-vehicles-heading" class="text-lg font-semibold text-foreground">
				Vehicles
			</h2>
			<p class="text-sm text-muted-foreground">Manage your vehicles</p>
		</div>
		<VehicleListManager
			{activeVehicleId}
			onActiveVehicleChange={handleActiveVehicleChange}
		/>
	</section>

	<section
		aria-labelledby="settings-reminders-heading"
		class="space-y-5 rounded-2xl border border-border bg-card p-5 shadow-sm"
	>
		<div class="space-y-1">
			<h2 id="settings-reminders-heading" class="text-lg font-semibold text-foreground">
				Reminders
			</h2>
			<p class="text-sm text-muted-foreground">Set maintenance reminders</p>
		</div>
		<p class="text-sm text-muted-foreground">Coming soon</p>
	</section>

	<section
		aria-labelledby="settings-cloud-sync-heading"
		class="space-y-5 rounded-2xl border border-border bg-card p-5 shadow-sm"
	>
		<div class="space-y-1">
			<h2 id="settings-cloud-sync-heading" class="text-lg font-semibold text-foreground">
				Cloud & Sync
			</h2>
			<p class="text-sm text-muted-foreground">Back up and sync your data</p>
		</div>
		<p class="text-sm text-muted-foreground">Coming soon</p>
	</section>

	<section
		aria-labelledby="settings-units-currency-heading"
		class="space-y-5 rounded-2xl border border-border bg-card p-5 shadow-sm"
	>
		<div class="space-y-1">
			<h2 id="settings-units-currency-heading" class="text-lg font-semibold text-foreground">
				Units & Currency
			</h2>
			<p class="text-sm text-muted-foreground">
				Choose how fuel efficiency and costs are displayed everywhere in the app.
			</p>
		</div>

		<form class="space-y-5" onsubmit={handleSettingsSubmit}>
			<fieldset aria-describedby={fuelUnitHelpId} class="space-y-3">
				<legend class="text-sm font-medium text-foreground">Fuel efficiency unit</legend>
				<p id={fuelUnitHelpId} class="text-sm text-muted-foreground">
					Save a unit preference to refresh result cards, history summaries, and entry details.
				</p>

				<div class="grid gap-2 sm:grid-cols-2">
					{#each SUPPORTED_UNITS as unit (unit)}
						<label
							class="flex min-h-11 cursor-pointer items-center gap-3 rounded-xl border border-border px-4 py-3 text-sm font-medium text-foreground"
						>
							<input bind:group={settingsFuelUnit} type="radio" name="fuel-unit" value={unit} />
							<span>{unit}</span>
						</label>
					{/each}
				</div>
			</fieldset>

			<div class="space-y-3">
				<div class="space-y-1">
					<label for="settings-currency" class="text-sm font-medium text-foreground">
						Currency prefix
					</label>
					<p id={currencyHelpId} class="text-sm text-muted-foreground">
						Choose a preset or enter a custom value such as `EUR `.
					</p>
				</div>

				<div class="flex flex-wrap gap-2">
					{#each PRESET_CURRENCIES as presetCurrency (presetCurrency)}
						<button
							type="button"
							onclick={() => handlePresetCurrencySelect(presetCurrency)}
							aria-pressed={settingsCurrency === presetCurrency}
							class="inline-flex min-h-11 items-center justify-center rounded-xl border border-border px-4 text-sm font-semibold text-foreground transition-colors hover:bg-muted/60"
						>
							{presetCurrency}
						</button>
					{/each}
				</div>

				<input
					id="settings-currency"
					bind:value={settingsCurrency}
					type="text"
					inputmode="text"
					oninput={handleCurrencyInput}
					aria-invalid={currencyError ? 'true' : undefined}
					aria-describedby={currencyError
						? `${currencyHelpId} ${currencyErrorId}`
						: currencyHelpId}
					class="block h-[52px] w-full rounded-xl border border-border px-3 py-2 text-base focus:outline-none focus:ring-2 focus:ring-ring"
				/>

				{#if currencyError}
					<p id={currencyErrorId} role="alert" class="text-sm text-destructive">
						{currencyError}
					</p>
				{/if}
			</div>

			<div class="border-t border-border pt-4">
				<button
					type="submit"
					class="inline-flex min-h-11 items-center justify-center rounded-xl bg-accent px-5 py-3 text-sm font-semibold text-accent-foreground"
				>
					Save settings
				</button>
			</div>

			{#if settingsErrorMessage}
				<p role="alert" class="text-sm text-destructive">{settingsErrorMessage}</p>
			{:else if settingsStatusMessage}
				<p role="status" class="text-sm text-muted-foreground">{settingsStatusMessage}</p>
			{/if}
		</form>
	</section>

	<section
		aria-labelledby="settings-data-heading"
		class="space-y-5 rounded-2xl border border-border bg-card p-5 shadow-sm"
	>
		<div class="space-y-1">
			<h2 id="settings-data-heading" class="text-lg font-semibold text-foreground">
				Data
			</h2>
			<p class="text-sm text-muted-foreground">Manage your app data</p>
		</div>
		<p class="text-sm text-muted-foreground">Coming soon</p>
	</section>
</div>
