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

describe('Fuel entry backward-compatibility redirect', () => {
	it('redirects /fuel-entry to /log with 307 status', async () => {
		const { load } = await import('./+page');

		try {
			load({} as never);
			expect.fail('Expected redirect to be thrown');
		} catch (e: unknown) {
			const err = e as { status: number; location: string };
			expect(err.status).toBe(307);
			expect(err.location).toBe('/log');
		}

		expect(mockRedirect).toHaveBeenCalledWith(307, '/log');
	});
});
