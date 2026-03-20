<script lang="ts">
	import { getContext } from 'svelte';
	import { SvelteMap } from 'svelte/reactivity';
	import { MAX_VEHICLES } from '$lib/config';
	import type {
		ImportRow,
		VehicleAssignment,
		VehicleGroup
	} from '$lib/utils/importTypes';
	import type { NewVehicle } from '$lib/db/schema';
	import type { VehiclesContext } from '$lib/utils/vehicleContext';

	interface ImportStepVehiclesProps {
		rows: ImportRow[];
		onVehiclesAssigned: (data: { assignments: VehicleAssignment[] }) => void;
	}

	let { rows, onVehiclesAssigned }: ImportStepVehiclesProps = $props();

	const vehiclesContext = getContext<VehiclesContext>('vehicles');

	function groupRowsByVehicle(importRows: ImportRow[]): VehicleGroup[] {
		// eslint-disable-next-line svelte/prefer-svelte-reactivity -- temporary computation, not reactive state
		const groups = new Map<string, ImportRow[]>();
		for (const row of importRows) {
			const name = row.data.sourceVehicleName || 'Unknown Vehicle';
			const existing = groups.get(name) || [];
			existing.push(row);
			groups.set(name, existing);
		}
		return [...groups.entries()].map(([name, groupRows]) => ({
			sourceVehicleName: name,
			rows: groupRows,
			rowCount: groupRows.length
		}));
	}

	let vehicleGroups = $derived(groupRowsByVehicle(rows));

	// Assignment state (SvelteMap is already reactive — do NOT wrap in $state)
	let assignments = new SvelteMap<string, VehicleAssignment>();
	let inlineFormData = new SvelteMap<string, Partial<NewVehicle>>();
	let inlineFormErrors = new SvelteMap<string, string>();
	let maxVehiclesError = $state<string | null>(null);

	let allAssigned = $derived(
		vehicleGroups.length > 0 &&
			vehicleGroups.every((g) => {
				const assignment = assignments.get(g.sourceVehicleName);
				if (!assignment) return false;
				if (assignment.assignmentType === 'existing') return true;
				if (assignment.assignmentType === 'new') {
					const formData = inlineFormData.get(g.sourceVehicleName);
					return (
						!!formData?.name?.trim() && !!formData?.make?.trim() && !!formData?.model?.trim()
					);
				}
				return false;
			})
	);

	// Auto-match: 1 group + 1 existing vehicle
	let autoMatched = $state(false);
	$effect(() => {
		if (
			vehicleGroups.length === 1 &&
			vehiclesContext.vehicles.length === 1 &&
			assignments.size === 0 &&
			!autoMatched
		) {
			const group = vehicleGroups[0];
			const vehicle = vehiclesContext.vehicles[0];
			assignments.set(group.sourceVehicleName, {
				sourceVehicleName: group.sourceVehicleName,
				rowCount: group.rowCount,
				assignmentType: 'existing',
				existingVehicleId: vehicle.id
			});
			autoMatched = true;
		}
	});

	function getDropdownValue(groupName: string): string {
		const assignment = assignments.get(groupName);
		if (!assignment) return '';
		if (assignment.assignmentType === 'new') return '__new__';
		return String(assignment.existingVehicleId ?? '');
	}

	function handleAssignmentChange(groupName: string, value: string) {
		maxVehiclesError = null;

		if (value === '__new__') {
			// Check MAX_VEHICLES
			const existingVehicleCount = vehiclesContext.vehicles.length;
			const currentNew = [...assignments.values()].filter(
				(a) => a.assignmentType === 'new' && a.sourceVehicleName !== groupName
			).length;

			if (existingVehicleCount + currentNew + 1 > MAX_VEHICLES) {
				maxVehiclesError = groupName;
				return;
			}

			const group = vehicleGroups.find((g) => g.sourceVehicleName === groupName);
			assignments.set(groupName, {
				sourceVehicleName: groupName,
				rowCount: group?.rowCount ?? 0,
				assignmentType: 'new'
			});
			inlineFormData.set(groupName, {
				name: groupName,
				make: '',
				model: ''
			});
			inlineFormErrors.delete(groupName);
		} else if (value === '') {
			assignments.delete(groupName);
			inlineFormData.delete(groupName);
			inlineFormErrors.delete(groupName);
		} else {
			const vehicleId = parseInt(value, 10);
			const group = vehicleGroups.find((g) => g.sourceVehicleName === groupName);
			assignments.set(groupName, {
				sourceVehicleName: groupName,
				rowCount: group?.rowCount ?? 0,
				assignmentType: 'existing',
				existingVehicleId: vehicleId
			});
			inlineFormData.delete(groupName);
			inlineFormErrors.delete(groupName);
		}
	}

	function handleInlineFormChange(groupName: string, field: keyof NewVehicle, value: string) {
		const existing = inlineFormData.get(groupName) || {};
		if (field === 'year') {
			const num = parseInt(value, 10);
			inlineFormData.set(groupName, { ...existing, year: isNaN(num) ? undefined : num });
		} else {
			inlineFormData.set(groupName, { ...existing, [field]: value });
		}

		// Update assignment with new vehicle data
		const assignment = assignments.get(groupName);
		if (assignment?.assignmentType === 'new') {
			const formData = inlineFormData.get(groupName)!;
			assignments.set(groupName, {
				...assignment,
				newVehicle: {
					name: formData.name?.trim() || '',
					make: formData.make?.trim() || '',
					model: formData.model?.trim() || '',
					year: formData.year
				}
			});
		}

		// Clear form error on change
		inlineFormErrors.delete(groupName);
	}

	function validateInlineForm(groupName: string): boolean {
		const formData = inlineFormData.get(groupName);
		if (!formData) return false;

		const errors: string[] = [];
		if (!formData.name?.trim()) errors.push('Name is required');
		if (!formData.make?.trim()) errors.push('Make is required');
		if (!formData.model?.trim()) errors.push('Model is required');
		if (formData.year !== undefined) {
			if (
				!Number.isInteger(formData.year) ||
				formData.year < 1900 ||
				formData.year > new Date().getFullYear()
			) {
				errors.push(`Year must be between 1900 and ${new Date().getFullYear()}`);
			}
		}

		if (errors.length > 0) {
			inlineFormErrors.set(groupName, errors.join('. '));
			return false;
		}
		inlineFormErrors.delete(groupName);
		return true;
	}

	function isGroupAssigned(groupName: string): boolean {
		const assignment = assignments.get(groupName);
		if (!assignment) return false;
		if (assignment.assignmentType === 'existing') return true;
		if (assignment.assignmentType === 'new') {
			const formData = inlineFormData.get(groupName);
			return !!formData?.name?.trim() && !!formData?.make?.trim() && !!formData?.model?.trim();
		}
		return false;
	}

	function handleReviewImport() {
		if (!allAssigned) return;

		// Validate all inline forms
		for (const [groupName, assignment] of assignments) {
			if (assignment.assignmentType === 'new') {
				if (!validateInlineForm(groupName)) return;
			}
		}

		// Build final assignments
		const finalAssignments: VehicleAssignment[] = [];
		for (const group of vehicleGroups) {
			const assignment = assignments.get(group.sourceVehicleName);
			if (!assignment) continue;

			if (assignment.assignmentType === 'new') {
				const formData = inlineFormData.get(group.sourceVehicleName);
				finalAssignments.push({
					...assignment,
					newVehicle: {
						name: formData!.name!.trim(),
						make: formData!.make!.trim(),
						model: formData!.model!.trim(),
						year: formData!.year
					}
				});
			} else {
				finalAssignments.push(assignment);
			}
		}

		onVehiclesAssigned({ assignments: finalAssignments });
	}
</script>

<div class="space-y-4">
	<p class="text-sm text-muted-foreground">
		Assign each vehicle from your import file to a passanger vehicle.
	</p>

	<!-- Auto-match confirmation -->
	{#if autoMatched && vehicleGroups.length === 1 && vehiclesContext.vehicles.length === 1}
		<div class="rounded-lg border border-accent/50 bg-accent/10 p-3" aria-live="polite">
			<p class="text-sm text-foreground">
				We'll add these rows to <strong>{vehiclesContext.vehicles[0].name}</strong>. Correct?
			</p>
			<p class="mt-1 text-xs text-muted-foreground">
				You can change the assignment below if needed.
			</p>
		</div>
	{/if}

	<!-- Vehicle group cards -->
	{#each vehicleGroups as group (group.sourceVehicleName)}
		{@const assigned = isGroupAssigned(group.sourceVehicleName)}
		{@const assignment = assignments.get(group.sourceVehicleName)}
		{@const formData = inlineFormData.get(group.sourceVehicleName)}
		{@const formError = inlineFormErrors.get(group.sourceVehicleName)}

		<div
			class="rounded-lg border p-4 space-y-3 {assigned
				? 'border-green-500 bg-green-50 dark:bg-green-950/20'
				: 'border-border bg-card'}"
			data-testid="vehicle-group-{group.sourceVehicleName}"
		>
			<!-- Header -->
			<div class="flex items-center justify-between">
				<div>
					<p class="text-sm font-semibold text-foreground">"{group.sourceVehicleName}"</p>
					<p class="text-xs text-muted-foreground">
						{group.rowCount} row{group.rowCount !== 1 ? 's' : ''}
					</p>
				</div>
				{#if assigned}
					<span
						class="inline-flex items-center rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-800 dark:bg-green-900/30 dark:text-green-400"
					>
						Matched
					</span>
				{/if}
			</div>

			<!-- Assignment dropdown -->
			<div>
				<label
					class="sr-only"
					for="assign-{group.sourceVehicleName}"
				>
					Assign {group.sourceVehicleName} to a passanger vehicle
				</label>
				<select
					id="assign-{group.sourceVehicleName}"
					class="h-12 w-full rounded-md border border-border bg-card px-3 text-sm text-foreground"
					aria-label="Assign {group.sourceVehicleName} to a passanger vehicle"
					value={getDropdownValue(group.sourceVehicleName)}
					onchange={(e) =>
						handleAssignmentChange(
							group.sourceVehicleName,
							(e.target as HTMLSelectElement).value
						)}
				>
					<option value="">Select vehicle…</option>
					{#each vehiclesContext.vehicles as vehicle (vehicle.id)}
						<option value={String(vehicle.id)}>{vehicle.name}</option>
					{/each}
					<option value="__new__">Create new vehicle</option>
				</select>
			</div>

			<!-- MAX_VEHICLES error -->
			{#if maxVehiclesError === group.sourceVehicleName}
				<p class="text-sm text-destructive" role="alert">
					You already have {MAX_VEHICLES} vehicles. Delete or reassign one in Settings before
					importing.
				</p>
			{/if}

			<!-- Inline vehicle creation form -->
			{#if assignment?.assignmentType === 'new'}
				<div class="space-y-3 border-t border-border pt-3">
					<div>
						<label
							class="block text-xs font-medium text-muted-foreground"
							for="new-vehicle-name-{group.sourceVehicleName}"
						>
							Name
						</label>
						<input
							id="new-vehicle-name-{group.sourceVehicleName}"
							type="text"
							class="mt-1 h-12 w-full rounded-md border border-border px-3 text-sm text-foreground"
							value={formData?.name ?? ''}
							oninput={(e) =>
								handleInlineFormChange(
									group.sourceVehicleName,
									'name',
									(e.target as HTMLInputElement).value
								)}
						/>
					</div>
					<div>
						<label
							class="block text-xs font-medium text-muted-foreground"
							for="new-vehicle-make-{group.sourceVehicleName}"
						>
							Make
						</label>
						<input
							id="new-vehicle-make-{group.sourceVehicleName}"
							type="text"
							class="mt-1 h-12 w-full rounded-md border border-border px-3 text-sm text-foreground"
							value={formData?.make ?? ''}
							oninput={(e) =>
								handleInlineFormChange(
									group.sourceVehicleName,
									'make',
									(e.target as HTMLInputElement).value
								)}
						/>
					</div>
					<div>
						<label
							class="block text-xs font-medium text-muted-foreground"
							for="new-vehicle-model-{group.sourceVehicleName}"
						>
							Model
						</label>
						<input
							id="new-vehicle-model-{group.sourceVehicleName}"
							type="text"
							class="mt-1 h-12 w-full rounded-md border border-border px-3 text-sm text-foreground"
							value={formData?.model ?? ''}
							oninput={(e) =>
								handleInlineFormChange(
									group.sourceVehicleName,
									'model',
									(e.target as HTMLInputElement).value
								)}
						/>
					</div>
					<div>
						<label
							class="block text-xs font-medium text-muted-foreground"
							for="new-vehicle-year-{group.sourceVehicleName}"
						>
							Year (optional)
						</label>
						<input
							id="new-vehicle-year-{group.sourceVehicleName}"
							type="text"
							inputmode="numeric"
							class="mt-1 h-12 w-full rounded-md border border-border px-3 text-sm text-foreground"
							value={formData?.year != null ? String(formData.year) : ''}
							oninput={(e) =>
								handleInlineFormChange(
									group.sourceVehicleName,
									'year',
									(e.target as HTMLInputElement).value
								)}
						/>
					</div>
					{#if formError}
						<p class="text-sm text-destructive" role="alert">{formError}</p>
					{/if}
				</div>
			{/if}
		</div>
	{/each}

	<!-- Primary action -->
	<button
		type="button"
		disabled={!allAssigned}
		class="inline-flex min-h-11 w-full items-center justify-center rounded-xl bg-accent px-5 py-3 text-sm font-semibold text-accent-foreground disabled:cursor-not-allowed disabled:opacity-70"
		data-testid="review-import-btn"
		onclick={handleReviewImport}
	>
		Review & Import
	</button>
</div>
