import { afterEach, describe, expect, it, vi } from 'vitest';
import { TOAST_DURATION_MS, TOAST_UNDO_DURATION_MS } from '$lib/config';

// Capture calls to the sonner singleton. The wrapper uses both the base callable `sonner(...)`
// (for action toasts) and its `.success` / `.error` methods, so the mock mirrors that shape.
const sonnerBase = vi.fn();
const sonnerSuccess = vi.fn();
const sonnerError = vi.fn();

vi.mock('svelte-sonner', () => {
	const toast = Object.assign((...args: unknown[]) => sonnerBase(...args), {
		success: (...args: unknown[]) => sonnerSuccess(...args),
		error: (...args: unknown[]) => sonnerError(...args)
	});
	return { toast };
});

// Import after the mock is registered so the wrapper binds to the mocked singleton.
const { toast } = await import('./toast');

afterEach(() => {
	vi.clearAllMocks();
});

describe('toast wrapper (AC2/AC3)', () => {
	it('success() forwards the message and default duration to sonner.success', () => {
		toast.success('Saved');
		expect(sonnerSuccess).toHaveBeenCalledWith('Saved', { duration: TOAST_DURATION_MS });
	});

	it('error() forwards the message, default duration, and important (assertive announce)', () => {
		toast.error('Save failed');
		expect(sonnerError).toHaveBeenCalledWith('Save failed', {
			duration: TOAST_DURATION_MS,
			important: true
		});
	});

	it('action() forwards the action label/onClick and the longer undo duration', () => {
		const onClick = vi.fn();
		toast.action('Deleted', { label: 'Undo', onClick });

		expect(sonnerBase).toHaveBeenCalledTimes(1);
		const [message, opts] = sonnerBase.mock.calls[0] as [string, Record<string, unknown>];
		expect(message).toBe('Deleted');
		expect(opts.duration).toBe(TOAST_UNDO_DURATION_MS);

		const action = opts.action as { label: string; onClick: () => void };
		expect(action.label).toBe('Undo');

		// The onClick handed to sonner is exactly the supplied callback (the Undo mechanism).
		expect(onClick).not.toHaveBeenCalled();
		action.onClick();
		expect(onClick).toHaveBeenCalledTimes(1);
	});
});
