import { db } from '../db';
import { ok, err } from '$lib/utils/result';
import type { Result } from '$lib/utils/result';
import type { Expense, NewExpense } from '../schema';
import { validateNewExpense, validatePartialExpense } from '../validators/rowValidation';
import { runWrite, encodeSentinel } from '../writeSkeleton';

export class ExpenseRepository {
	async saveExpense(entry: NewExpense): Promise<Result<Expense>> {
		return runWrite(
			() => validateNewExpense(entry),
			async () => {
				const id = await db.expenses.add({ ...entry } as Expense);
				const saved = await db.expenses.get(id as number);
				if (!saved) throw encodeSentinel('SAVE_FAILED', 'Record not found after insert');
				return saved;
			},
			'SAVE_FAILED'
		);
	}

	async getExpenseById(id: number): Promise<Result<Expense>> {
		try {
			const expense = await db.expenses.get(id);
			if (!expense) return err('NOT_FOUND', `Expense ${id} not found`);
			return ok(expense);
		} catch (e) {
			return err('GET_FAILED', String(e));
		}
	}

	async getAllExpenses(vehicleId?: number): Promise<Result<Expense[]>> {
		try {
			const expenses =
				vehicleId !== undefined
					? await db.expenses.where('vehicleId').equals(vehicleId).toArray()
					: await db.expenses.toArray();
			return ok(expenses);
		} catch (e) {
			return err('GET_FAILED', String(e));
		}
	}

	async updateExpense(id: number, changes: Partial<NewExpense>): Promise<Result<Expense>> {
		return runWrite(
			() => validatePartialExpense(changes),
			async () => {
				const count = await db.expenses.update(id, changes);
				if (count === 0) throw encodeSentinel('NOT_FOUND', `Expense ${id} not found`);
				const updated = await db.expenses.get(id);
				if (!updated) throw encodeSentinel('UPDATE_FAILED', 'Record not found after update');
				return updated;
			},
			'UPDATE_FAILED'
		);
	}

	async deleteExpense(id: number): Promise<Result<void>> {
		return runWrite(
			() => null,
			() =>
				db.transaction('rw', db.expenses, async () => {
					const existing = await db.expenses.get(id);
					if (!existing) throw encodeSentinel('NOT_FOUND', `Expense ${id} not found`);
					await db.expenses.delete(id);
				}),
			'DELETE_FAILED'
		);
	}

	// Inverse of deleteExpense: re-insert a deleted expense's snapshot at its ORIGINAL id (via
	// put()). Expenses don't affect the fuel-consumption timeline, so there is no neighbor recompute.
	async restoreExpense(snapshot: Expense): Promise<Result<void>> {
		return runWrite(
			() => null,
			() =>
				db.transaction('rw', db.expenses, async () => {
					// The id should be free (Dexie ++id never reissues a deleted id); guard defensively.
					const existing = await db.expenses.get(snapshot.id);
					if (existing)
						throw encodeSentinel('SAVE_FAILED', `Expense ${snapshot.id} already present`);
					await db.expenses.put(snapshot);
				}),
			'SAVE_FAILED'
		);
	}
}

export const expenseRepository = new ExpenseRepository();

// Convenience function exports — delegate to repository instance for backward compatibility
export const saveExpense = (entry: NewExpense) => expenseRepository.saveExpense(entry);
export const getExpenseById = (id: number) => expenseRepository.getExpenseById(id);
export const getAllExpenses = (vehicleId?: number) => expenseRepository.getAllExpenses(vehicleId);
export const updateExpense = (id: number, changes: Partial<NewExpense>) =>
	expenseRepository.updateExpense(id, changes);
export const deleteExpense = (id: number) => expenseRepository.deleteExpense(id);
export const restoreExpense = (snapshot: Expense) => expenseRepository.restoreExpense(snapshot);
