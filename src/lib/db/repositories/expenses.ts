import { db } from '../db';
import { ok, err } from '$lib/utils/result';
import type { Result } from '$lib/utils/result';
import type { Expense, NewExpense } from '../schema';

function validateNewExpense(entry: NewExpense): string | null {
	if (!Number.isInteger(entry.vehicleId) || entry.vehicleId <= 0)
		return 'vehicleId must be a positive integer';
	if (!(entry.date instanceof Date) || isNaN(entry.date.getTime()))
		return 'date must be a valid Date';
	if (!entry.type || entry.type.trim() === '') return 'Expense type is required';
	if (
		entry.odometer !== undefined &&
		(typeof entry.odometer !== 'number' || !Number.isFinite(entry.odometer) || entry.odometer < 0)
	)
		return 'odometer must be a non-negative finite number';
	if (typeof entry.cost !== 'number' || !Number.isFinite(entry.cost) || entry.cost < 0)
		return 'cost must be a non-negative finite number';
	return null;
}

function validatePartialExpense(changes: Partial<NewExpense>): string | null {
	if (
		'vehicleId' in changes &&
		(!Number.isInteger(changes.vehicleId) || (changes.vehicleId as number) <= 0)
	)
		return 'vehicleId must be a positive integer';
	if (
		'date' in changes &&
		(!(changes.date instanceof Date) || isNaN((changes.date as Date).getTime()))
	)
		return 'date must be a valid Date';
	if ('type' in changes && (!changes.type || (changes.type as string).trim() === ''))
		return 'Expense type cannot be empty';
	if (
		'odometer' in changes &&
		changes.odometer !== undefined &&
		(typeof changes.odometer !== 'number' ||
			!Number.isFinite(changes.odometer as number) ||
			(changes.odometer as number) < 0)
	)
		return 'odometer must be a non-negative finite number';
	if (
		'cost' in changes &&
		(typeof changes.cost !== 'number' ||
			!Number.isFinite(changes.cost as number) ||
			(changes.cost as number) < 0)
	)
		return 'cost must be a non-negative finite number';
	return null;
}

export class ExpenseRepository {
	async saveExpense(entry: NewExpense): Promise<Result<Expense>> {
		const validationError = validateNewExpense(entry);
		if (validationError) return err('VALIDATION_ERROR', validationError);
		try {
			const id = await db.expenses.add({ ...entry } as Expense);
			const saved = await db.expenses.get(id as number);
			if (!saved) return err('SAVE_FAILED', 'Record not found after insert');
			return ok(saved);
		} catch (e) {
			return err('SAVE_FAILED', String(e));
		}
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
		const validationError = validatePartialExpense(changes);
		if (validationError) return err('VALIDATION_ERROR', validationError);
		try {
			const count = await db.expenses.update(id, changes);
			if (count === 0) return err('NOT_FOUND', `Expense ${id} not found`);
			const updated = await db.expenses.get(id);
			if (!updated) return err('UPDATE_FAILED', 'Record not found after update');
			return ok(updated);
		} catch (e) {
			return err('UPDATE_FAILED', String(e));
		}
	}

	async deleteExpense(id: number): Promise<Result<void>> {
		try {
			await db.transaction('rw', db.expenses, async () => {
				const existing = await db.expenses.get(id);
				if (!existing) {
					throw new Error(`NOT_FOUND:${id}`);
				}

				await db.expenses.delete(id);
			});
			return ok(undefined);
		} catch (e) {
			const message = String(e);
			if (message.startsWith('Error: NOT_FOUND:')) {
				const missingId = message.replace('Error: NOT_FOUND:', '');
				return err('NOT_FOUND', `Expense ${missingId} not found`);
			}

			return err('DELETE_FAILED', message);
		}
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
