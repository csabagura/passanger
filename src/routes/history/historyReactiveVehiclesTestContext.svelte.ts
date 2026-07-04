import type { Vehicle } from '$lib/db/schema';

// Test-only helper: a REAL $state-backed 'vehicles' context, mirroring +layout.svelte's actual
// shape closely enough to exercise effects that key off `activeVehicle` reactively (S29) — a plain
// object with getters over a mutable closure variable is NOT reactive; Svelte's $effect only
// re-runs on reads of an actual reactive source.
export function createReactiveVehiclesTestContext(initialVehicles: Vehicle[] = []) {
	const vehicles = $state<Vehicle[]>(initialVehicles);
	let activeVehicleId = $state<number | null>(initialVehicles[0]?.id ?? null);
	const activeVehicle = $derived(
		activeVehicleId !== null ? (vehicles.find((v) => v.id === activeVehicleId) ?? null) : null
	);

	return {
		get vehicles() {
			return vehicles;
		},
		get activeVehicle() {
			return activeVehicle;
		},
		get activeVehicleId() {
			return activeVehicleId;
		},
		get loaded() {
			return true;
		},
		get vehiclesError() {
			return false;
		},
		switchVehicle(id: number) {
			activeVehicleId = id;
		},
		async refreshVehicles() {},
		/** Test-only: simulate the active vehicle disappearing (deleted / switched away). */
		clearActiveVehicle() {
			activeVehicleId = null;
		}
	};
}
