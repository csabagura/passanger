import { describe, it, expect, vi } from 'vitest';

const mockRedirect = vi.fn();

vi.mock('@sveltejs/kit', () => ({
	redirect: (...args: unknown[]) => {
		mockRedirect(...args);
		throw { status: args[0], location: args[1] };
	}
}));

vi.mock('$app/paths', () => ({
	resolve: (path: string) => path
}));

describe('Root route redirect (+page.ts)', () => {
	it('redirects to /fuel-entry with 307 status', async () => {
		const { load } = await import('./+page');

		try {
			load({} as never);
			expect.fail('Expected redirect to be thrown');
		} catch (e: unknown) {
			const err = e as { status: number; location: string };
			expect(err.status).toBe(307);
			expect(err.location).toBe('/fuel-entry');
		}

		expect(mockRedirect).toHaveBeenCalledWith(307, '/fuel-entry');
	});

	it('uses resolve() to make redirect base-path-safe', async () => {
		// Reset modules to re-mock with a base path
		vi.resetModules();

		vi.doMock('$app/paths', () => ({
			resolve: (path: string) => '/base' + path
		}));

		vi.doMock('@sveltejs/kit', () => ({
			redirect: (...args: unknown[]) => {
				mockRedirect(...args);
				throw { status: args[0], location: args[1] };
			}
		}));

		mockRedirect.mockClear();

		const { load } = await import('./+page');

		try {
			load({} as never);
		} catch {
			// Expected
		}

		expect(mockRedirect).toHaveBeenCalledWith(307, '/base/fuel-entry');
	});
});
