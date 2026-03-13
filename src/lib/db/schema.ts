export interface Vehicle {
	id: number; // auto-increment
	name: string; // display name (e.g., "My Honda")
	make: string; // e.g., "Honda"
	model: string; // e.g., "Civic"
	year?: number; // optional — user may not know
}
export type NewVehicle = Omit<Vehicle, 'id'>;

export interface FuelLog {
	id: number;
	vehicleId: number;
	date: Date; // JS Date object — NOT string/timestamp
	odometer: number; // km or miles
	quantity: number; // litres or gallons (depends on unit)
	unit: 'L' | 'gal'; // storage unit for quantity
	distanceUnit: 'km' | 'mi'; // distance unit used at time of log (FIX #2: prevents mixed-unit calculations)
	totalCost: number; // float (display with toFixed(2) at UI layer)
	calculatedConsumption: number; // L/100km or MPG — computed on save
	notes?: string;
}
export type NewFuelLog = Omit<FuelLog, 'id'>;

export interface Expense {
	id: number;
	vehicleId: number;
	date: Date;
	type: string; // free text: "Oil Change", "Tyres", "Insurance", etc.
	odometer?: number; // optional for expenses
	cost: number; // float
	notes?: string;
}
export type NewExpense = Omit<Expense, 'id'>;
