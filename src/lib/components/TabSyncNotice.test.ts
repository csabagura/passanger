import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/svelte';
import TabSyncNotice from './TabSyncNotice.svelte';

afterEach(() => {
	cleanup();
});

describe('TabSyncNotice', () => {
	describe('hidden state', () => {
		it('renders nothing when there is no cue and no pending restore', () => {
			render(TabSyncNotice, { props: { cue: null, restorePending: false, onReload: vi.fn() } });
			expect(screen.queryByRole('status')).toBeNull();
			expect(screen.queryByRole('alert')).toBeNull();
		});
	});

	describe('subtle cue', () => {
		it('shows a polite "Updated in another tab" status for a data change', () => {
			render(TabSyncNotice, { props: { cue: 'data', restorePending: false, onReload: vi.fn() } });
			const region = screen.getByRole('status');
			expect(region.getAttribute('aria-live')).toBe('polite');
			expect(screen.getByText('Updated in another tab')).toBeTruthy();
		});

		it('shows the same cue for a settings change', () => {
			render(TabSyncNotice, {
				props: { cue: 'settings', restorePending: false, onReload: vi.fn() }
			});
			expect(screen.getByText('Updated in another tab')).toBeTruthy();
		});
	});

	describe('restore prompt', () => {
		it('shows a prominent alert with a Reload button when a restore is pending', () => {
			render(TabSyncNotice, { props: { cue: null, restorePending: true, onReload: vi.fn() } });
			expect(screen.getByRole('alert')).toBeTruthy();
			expect(screen.getByText(/replaced by a restore in another tab/i)).toBeTruthy();
			expect(screen.getByRole('button', { name: /reload/i })).toBeTruthy();
		});

		it('calls onReload when the Reload button is clicked', async () => {
			const onReload = vi.fn();
			render(TabSyncNotice, { props: { cue: null, restorePending: true, onReload } });
			await fireEvent.click(screen.getByRole('button', { name: /reload/i }));
			expect(onReload).toHaveBeenCalledOnce();
		});

		it('takes precedence over a cue (restore shown, cue suppressed)', () => {
			render(TabSyncNotice, { props: { cue: 'data', restorePending: true, onReload: vi.fn() } });
			expect(screen.getByRole('alert')).toBeTruthy();
			expect(screen.queryByText('Updated in another tab')).toBeNull();
		});
	});
});
