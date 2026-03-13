import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/svelte';
import StorageProtectionNotice from './StorageProtectionNotice.svelte';

afterEach(() => {
	cleanup();
});

describe('StorageProtectionNotice', () => {
	describe('exact copy (AC3)', () => {
		it('renders the exact required notice text', () => {
			render(StorageProtectionNotice, { props: { ondismiss: vi.fn() } });
			expect(
				screen.getByText(
					'Storage protection unavailable on this browser - export your data regularly to prevent loss'
				)
			).toBeTruthy();
		});
	});

	describe('accessible live-region semantics', () => {
		it('has role="status" for polite live region', () => {
			render(StorageProtectionNotice, { props: { ondismiss: vi.fn() } });
			const region = screen.getByRole('status');
			expect(region).toBeTruthy();
		});

		it('has aria-live="polite" so announcement does not steal focus', () => {
			render(StorageProtectionNotice, { props: { ondismiss: vi.fn() } });
			const region = screen.getByRole('status');
			expect(region.getAttribute('aria-live')).toBe('polite');
		});
	});

	describe('dismiss behavior', () => {
		it('renders a dismiss button', () => {
			render(StorageProtectionNotice, { props: { ondismiss: vi.fn() } });
			const btn = screen.getByRole('button', { name: /dismiss/i });
			expect(btn).toBeTruthy();
		});

		it('calls ondismiss when the dismiss button is clicked', () => {
			const ondismiss = vi.fn();
			render(StorageProtectionNotice, { props: { ondismiss } });
			fireEvent.click(screen.getByRole('button', { name: /dismiss/i }));
			expect(ondismiss).toHaveBeenCalledOnce();
		});

		it('does not call ondismiss before the button is clicked', () => {
			const ondismiss = vi.fn();
			render(StorageProtectionNotice, { props: { ondismiss } });
			expect(ondismiss).not.toHaveBeenCalled();
		});
	});

	describe('token-backed styling (no hard-coded colors)', () => {
		it('uses bg-muted token class (not hard-coded hex)', () => {
			render(StorageProtectionNotice, { props: { ondismiss: vi.fn() } });
			// The inner card div carries bg-muted
			const card = document.querySelector('.bg-muted');
			expect(card).not.toBeNull();
		});

		it('uses text-muted-foreground token class', () => {
			render(StorageProtectionNotice, { props: { ondismiss: vi.fn() } });
			const card = document.querySelector('.text-muted-foreground');
			expect(card).not.toBeNull();
		});

		it('uses border-border token class (not hard-coded hex)', () => {
			render(StorageProtectionNotice, { props: { ondismiss: vi.fn() } });
			const card = document.querySelector('.border-border');
			expect(card).not.toBeNull();
		});
	});
});
