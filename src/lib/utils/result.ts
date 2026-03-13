export type AppError = { code: string; message: string };

export type Result<T> = { data: T; error: null } | { data: null; error: AppError };

export function ok<T>(data: T): Result<T> {
	return { data, error: null };
}

export function err(code: string, message: string): Result<never> {
	return { data: null, error: { code, message } };
}
