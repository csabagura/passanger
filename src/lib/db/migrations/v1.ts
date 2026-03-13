// v1 Baseline Schema — passangerDB version 1
//
// This file documents the initial schema. No migration function is required for v1
// since it is the starting schema. Future schema changes will add v2.ts with a
// proper upgrade function and corresponding Vitest migration test.
//
// Schema (Dexie stores() index strings):
//   vehicles:  '++id, name, make, model, year'
//   fuelLogs:  '++id, vehicleId, date, odometer'
//   expenses:  '++id, vehicleId, date, type, odometer'
//
// Full field definitions (all stored, only indexed fields listed in stores()):
//   vehicles:  id, name, make, model, year?
//   fuelLogs:  id, vehicleId, date, odometer, quantity, unit, totalCost, calculatedConsumption, notes?
//   expenses:  id, vehicleId, date, type, odometer?, cost, notes?
//
// Settings are stored in localStorage only — no settings table in Dexie.
