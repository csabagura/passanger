// @vitest-environment node
import 'fake-indexeddb/auto'; // MUST be first import — patches global IndexedDB
import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '../db';
import {
	saveExpense,
	getExpenseById,
	getAllExpenses,
	updateExpense,
	deleteExpense
} from './expenses';
import type { NewExpense } from '../schema';

// Factory functions — Dexie v4 mutates the input object after add() to set the id.
// Always create fresh objects per test to avoid cross-test contamination.
const makeExpense = (): NewExpense => ({
	vehicleId: 1,
	date: new Date('2025-01-20'),
	type: 'Oil Change',
	odometer: 50000,
	cost: 35.0,
	notes: 'Synthetic oil'
});

const makeExpenseNoOdometer = (): NewExpense => ({
	vehicleId: 1,
	date: new Date('2025-02-10'),
	type: 'Insurance',
	cost: 120.0
});

beforeEach(async () => {
	await db.delete();
	await db.open();
});

describe('ExpenseRepository', () => {
	describe('saveExpense — validation', () => {
		it('rejects non-positive vehicleId', async () => {
			const result = await saveExpense({ ...makeExpense(), vehicleId: 0 });
			expect(result.data).toBeNull();
			expect(result.error?.code).toBe('VALIDATION_ERROR');
		});

		it('rejects invalid date', async () => {
			const result = await saveExpense({ ...makeExpense(), date: new Date('not-a-date') });
			expect(result.data).toBeNull();
			expect(result.error?.code).toBe('VALIDATION_ERROR');
		});

		it('rejects empty type', async () => {
			const result = await saveExpense({ ...makeExpense(), type: '' });
			expect(result.data).toBeNull();
			expect(result.error?.code).toBe('VALIDATION_ERROR');
		});

		it('rejects whitespace-only type', async () => {
			const result = await saveExpense({ ...makeExpense(), type: '   ' });
			expect(result.data).toBeNull();
			expect(result.error?.code).toBe('VALIDATION_ERROR');
		});

		it('rejects negative odometer', async () => {
			const result = await saveExpense({ ...makeExpense(), odometer: -10 });
			expect(result.data).toBeNull();
			expect(result.error?.code).toBe('VALIDATION_ERROR');
		});

		it('rejects negative cost', async () => {
			const result = await saveExpense({ ...makeExpense(), cost: -1 });
			expect(result.data).toBeNull();
			expect(result.error?.code).toBe('VALIDATION_ERROR');
		});

		it('rejects NaN cost', async () => {
			const result = await saveExpense({ ...makeExpense(), cost: NaN });
			expect(result.data).toBeNull();
			expect(result.error?.code).toBe('VALIDATION_ERROR');
		});

		it('rejects Infinity cost', async () => {
			const result = await saveExpense({ ...makeExpense(), cost: Infinity });
			expect(result.data).toBeNull();
			expect(result.error?.code).toBe('VALIDATION_ERROR');
		});

		it('rejects -Infinity cost', async () => {
			const result = await saveExpense({ ...makeExpense(), cost: -Infinity });
			expect(result.data).toBeNull();
			expect(result.error?.code).toBe('VALIDATION_ERROR');
		});

		it('rejects Infinity odometer', async () => {
			const result = await saveExpense({ ...makeExpense(), odometer: Infinity });
			expect(result.data).toBeNull();
			expect(result.error?.code).toBe('VALIDATION_ERROR');
		});
	});

	describe('updateExpense — validation', () => {
		it('rejects empty type in changes', async () => {
			const saved = await saveExpense(makeExpense());
			const result = await updateExpense(saved.data!.id, { type: '' });
			expect(result.data).toBeNull();
			expect(result.error?.code).toBe('VALIDATION_ERROR');
		});

		it('rejects negative cost in changes', async () => {
			const saved = await saveExpense(makeExpense());
			const result = await updateExpense(saved.data!.id, { cost: -5 });
			expect(result.data).toBeNull();
			expect(result.error?.code).toBe('VALIDATION_ERROR');
		});

		it('rejects Infinity cost in changes', async () => {
			const saved = await saveExpense(makeExpense());
			const result = await updateExpense(saved.data!.id, { cost: Infinity });
			expect(result.data).toBeNull();
			expect(result.error?.code).toBe('VALIDATION_ERROR');
		});
	});

	describe('saveExpense', () => {
		it('returns ok with saved expense including id', async () => {
			const result = await saveExpense(makeExpense());
			expect(result.error).toBeNull();
			expect(result.data?.id).toBeDefined();
			expect(typeof result.data?.id).toBe('number');
			expect(result.data?.vehicleId).toBe(1);
			expect(result.data?.type).toBe('Oil Change');
			expect(result.data?.cost).toBe(35.0);
		});

		it('saves with optional odometer field', async () => {
			const result = await saveExpense(makeExpense());
			expect(result.error).toBeNull();
			expect(result.data?.odometer).toBe(50000);
		});

		it('saves without optional odometer field', async () => {
			const result = await saveExpense(makeExpenseNoOdometer());
			expect(result.error).toBeNull();
			expect(result.data?.odometer).toBeUndefined();
		});

		it('saves with optional notes field', async () => {
			const result = await saveExpense(makeExpense());
			expect(result.error).toBeNull();
			expect(result.data?.notes).toBe('Synthetic oil');
		});

		it('saves without optional notes field', async () => {
			const result = await saveExpense(makeExpenseNoOdometer());
			expect(result.error).toBeNull();
			expect(result.data?.notes).toBeUndefined();
		});
	});

	describe('getExpenseById', () => {
		it('returns the expense when found', async () => {
			const saved = await saveExpense(makeExpense());
			const result = await getExpenseById(saved.data!.id);
			expect(result.error).toBeNull();
			expect(result.data?.id).toBe(saved.data!.id);
			expect(result.data?.type).toBe('Oil Change');
		});

		it('returns err with NOT_FOUND when id does not exist', async () => {
			const result = await getExpenseById(999);
			expect(result.data).toBeNull();
			expect(result.error?.code).toBe('NOT_FOUND');
		});
	});

	describe('getAllExpenses', () => {
		it('returns empty array when no records', async () => {
			const result = await getAllExpenses();
			expect(result.error).toBeNull();
			expect(result.data).toEqual([]);
		});

		it('returns all expenses when no vehicleId filter', async () => {
			await saveExpense(makeExpense());
			await saveExpense({ ...makeExpenseNoOdometer(), vehicleId: 2 });
			const result = await getAllExpenses();
			expect(result.error).toBeNull();
			expect(result.data).toHaveLength(2);
		});

		it('filters by vehicleId when provided', async () => {
			await saveExpense({ ...makeExpense(), vehicleId: 1, type: 'Oil Change' });
			await saveExpense({ ...makeExpense(), vehicleId: 1, type: 'Tyres' });
			await saveExpense({ ...makeExpenseNoOdometer(), vehicleId: 2 });
			const result = await getAllExpenses(1);
			expect(result.error).toBeNull();
			expect(result.data).toHaveLength(2);
			expect(result.data?.every((e) => e.vehicleId === 1)).toBe(true);
		});

		it('returns empty array for vehicleId with no expenses', async () => {
			await saveExpense(makeExpense()); // vehicleId: 1
			const result = await getAllExpenses(99);
			expect(result.error).toBeNull();
			expect(result.data).toEqual([]);
		});
	});

	describe('updateExpense', () => {
		it('persists cost change while preserving other fields', async () => {
			const saved = await saveExpense(makeExpense());
			const updated = await updateExpense(saved.data!.id, { cost: 50.0 });
			expect(updated.error).toBeNull();
			expect(updated.data?.cost).toBe(50.0);
			expect(updated.data?.vehicleId).toBe(1);
			expect(updated.data?.type).toBe('Oil Change');
		});

		it('returns err with NOT_FOUND when id does not exist', async () => {
			const result = await updateExpense(999, { cost: 10 });
			expect(result.data).toBeNull();
			expect(result.error?.code).toBe('NOT_FOUND');
		});
	});

	describe('deleteExpense', () => {
		it('removes the record so subsequent get returns NOT_FOUND', async () => {
			const saved = await saveExpense(makeExpense());
			const deleteResult = await deleteExpense(saved.data!.id);
			expect(deleteResult.error).toBeNull();
			const fetched = await getExpenseById(saved.data!.id);
			expect(fetched.error?.code).toBe('NOT_FOUND');
		});

		it('returns NOT_FOUND for a non-existent id', async () => {
			const result = await deleteExpense(999);
			expect(result.data).toBeNull();
			expect(result.error?.code).toBe('NOT_FOUND');
		});
	});
});
