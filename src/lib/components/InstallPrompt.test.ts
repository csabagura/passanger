import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';
import InstallPrompt from './InstallPrompt.svelte';

describe('InstallPrompt', () => {
	it('renders the iOS instructional variant with complementary semantics', () => {
		render(InstallPrompt, {
			props: {
				platform: 'ios',
				onDismiss: vi.fn()
			}
		});

		const prompt = screen.getByRole('complementary', {
			name: /install passanger on your home screen/i
		});

		expect(prompt).toBeTruthy();
		expect(screen.getByText(/tap the share icon/i)).toBeTruthy();
		expect(screen.queryByRole('dialog')).toBeNull();
	});

	it('renders the Android CTA only when a native prompt is available', () => {
		render(InstallPrompt, {
			props: {
				platform: 'android',
				canTriggerNativeInstall: true,
				onDismiss: vi.fn(),
				onInstall: vi.fn()
			}
		});

		expect(screen.getByRole('button', { name: 'Install' })).toBeTruthy();
		expect(screen.queryByText(/tap the share icon/i)).toBeNull();
	});

	it('calls onInstall when the Android CTA is tapped', async () => {
		const onInstall = vi.fn().mockResolvedValue(undefined);
		render(InstallPrompt, {
			props: {
				platform: 'android',
				canTriggerNativeInstall: true,
				onDismiss: vi.fn(),
				onInstall
			}
		});

		await fireEvent.click(screen.getByRole('button', { name: 'Install' }));
		expect(onInstall).toHaveBeenCalledOnce();
	});

	it('calls onDismiss from the dismiss control', async () => {
		const onDismiss = vi.fn();
		render(InstallPrompt, {
			props: {
				platform: 'ios',
				onDismiss
			}
		});

		await fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
		expect(onDismiss).toHaveBeenCalledOnce();
	});

	it('uses token-backed classes instead of hard-coded colors', () => {
		render(InstallPrompt, {
			props: {
				platform: 'android',
				canTriggerNativeInstall: true,
				onDismiss: vi.fn(),
				onInstall: vi.fn()
			}
		});

		const prompt = screen.getByRole('complementary', {
			name: /install passanger on your home screen/i
		});
		expect(prompt.className).toContain('bg-card');
		expect(prompt.className).toContain('border-border');
		expect(prompt.className).not.toContain('#');
	});
});
