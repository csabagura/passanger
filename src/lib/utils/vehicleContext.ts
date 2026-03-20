import type { Vehicle } from '$lib/db/schema';

export interface VehiclesContext {
	readonly vehicles: Vehicle[];
	readonly activeVehicle: Vehicle | null;
	readonly activeVehicleId: number | null;
	readonly loaded: boolean;
	switchVehicle: (id: number) => void;
	refreshVehicles: () => Promise<void>;
}
