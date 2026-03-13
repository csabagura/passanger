import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/svelte';
import { flushSync } from 'svelte';
import LayoutInstallPrompt from './LayoutInstallPrompt.test.svelte';

const mockRequestStoragePersistence =
	vi.fn<() => Promise<import('$lib/utils/storagePersistence').StoragePersistenceOutcome>>();
const mockHasNoticeDismissed = vi.fn<() => boolean>();
const mockMarkNoticeDismissed = vi.fn<() => void>();

vi.mock('$lib/utils/storagePersistence', () => ({
	requestStoragePersistence: () => mockRequestStoragePersistence(),
	hasNoticeDismissed: () => mockHasNoticeDismissed(),
	markNoticeDismissed: () => mockMarkNoticeDismissed()
}));

vi.mock('$lib/utils/settings', () => ({
	getSettings: () => ({ fuelUnit: 'L/100km' as const, currency: '€' as const })
}));

vi.mock('virtual:pwa-register', () => ({
	registerSW: vi.fn(() => vi.fn())
}));

vi.mock('$app/state', () => ({
	page: { url: { pathname: '/fuel-entry' } }
}));

vi.mock('$app/paths', () => ({
	resolve: (href: string) => href
}));

function createMatchMediaController(initialMatches = false) {
	let matches = initialMatches;
	const listeners = new Set<(event: MediaQueryListEvent) => void>();

	const matchMedia = vi.fn(
		(query: string) =>
			({
				media: query,
				get matches() {
					return matches;
				},
				addEventListener: (_type: string, listener: (event: MediaQueryListEvent) => void) => {
					listeners.add(listener);
				},
				removeEventListener: (_type: string, listener: (event: MediaQueryListEvent) => void) => {
					listeners.delete(listener);
				},
				addListener: (listener: (event: MediaQueryListEvent) => void) => {
					listeners.add(listener);
				},
				removeListener: (listener: (event: MediaQueryListEvent) => void) => {
					listeners.delete(listener);
				}
			}) as MediaQueryList
	);

	return {
		matchMedia,
		setMatches(nextMatches: boolean) {
			matches = nextMatches;
			const event = { matches } as MediaQueryListEvent;
			for (const listener of listeners) {
				listener(event);
			}
		}
	};
}

function createBeforeInstallPromptEvent(options?: { outcome?: 'accepted' | 'dismissed' }) {
	const prompt = vi.fn().mockResolvedValue(undefined);
	const event = new Event('beforeinstallprompt', { cancelable: true }) as Event & {
		prompt: typeof prompt;
		userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
	};

	Object.assign(event, {
		prompt,
		userChoice: Promise.resolve({
			outcome: options?.outcome ?? 'accepted',
			platform: 'web'
		})
	});

	return { event, prompt };
}

async function renderLayout() {
	render(LayoutInstallPrompt);
	await new Promise((resolve) => setTimeout(resolve, 0));
	flushSync();
}

describe('layout install prompt context', () => {
	const originalUserAgent = navigator.userAgent;
	const originalMatchMedia = window.matchMedia;

	beforeEach(() => {
		cleanup();
		vi.clearAllMocks();
		mockHasNoticeDismissed.mockReturnValue(false);
		mockRequestStoragePersistence.mockResolvedValue('granted');
		Object.defineProperty(window, 'matchMedia', {
			value: createMatchMediaController(false).matchMedia,
			configurable: true,
			writable: true
		});
		Object.defineProperty(navigator, 'userAgent', {
			value:
				'Mozilla/5.0 (Linux; Android 15; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Mobile Safari/537.36',
			configurable: true
		});
	});

	afterEach(() => {
		Object.defineProperty(window, 'matchMedia', {
			value: originalMatchMedia,
			configurable: true,
			writable: true
		});
		Object.defineProperty(navigator, 'userAgent', {
			value: originalUserAgent,
			configurable: true
		});
	});

	it('captures a deferred beforeinstallprompt event and exposes an Android install CTA state', async () => {
		await renderLayout();

		const { event } = createBeforeInstallPromptEvent();
		window.dispatchEvent(event);
		flushSync();

		expect(screen.getByTestId('install-platform').textContent).toBe('android');
		expect(screen.getByTestId('install-can-show').textContent).toBe('true');
		expect(screen.getByTestId('install-can-trigger').textContent).toBe('true');
	});

	it('suppresses the install prompt when standalone mode becomes active', async () => {
		const controller = createMatchMediaController(false);
		Object.defineProperty(window, 'matchMedia', {
			value: controller.matchMedia,
			configurable: true,
			writable: true
		});

		await renderLayout();
		window.dispatchEvent(createBeforeInstallPromptEvent().event);
		flushSync();
		expect(screen.getByTestId('install-can-show').textContent).toBe('true');

		controller.setMatches(true);
		flushSync();

		expect(screen.getByTestId('install-standalone').textContent).toBe('true');
		expect(screen.getByTestId('install-can-show').textContent).toBe('false');
		expect(screen.getByTestId('install-can-trigger').textContent).toBe('false');
	});

	it('clears retained install state after appinstalled', async () => {
		await renderLayout();
		window.dispatchEvent(createBeforeInstallPromptEvent().event);
		flushSync();
		expect(screen.getByTestId('install-can-trigger').textContent).toBe('true');

		window.dispatchEvent(new Event('appinstalled'));
		flushSync();

		expect(screen.getByTestId('install-dismissed').textContent).toBe('true');
		expect(screen.getByTestId('install-can-show').textContent).toBe('false');
		expect(screen.getByTestId('install-can-trigger').textContent).toBe('false');
	});

	it('prompts once and hides the in-app promotion afterwards', async () => {
		await renderLayout();

		const { event, prompt } = createBeforeInstallPromptEvent({ outcome: 'dismissed' });
		window.dispatchEvent(event);
		flushSync();

		await fireEvent.click(screen.getByRole('button', { name: 'Prompt install' }));
		await Promise.resolve();
		flushSync();

		expect(prompt).toHaveBeenCalledOnce();
		expect(screen.getByTestId('install-result').textContent).toBe('dismissed');
		expect(screen.getByTestId('install-can-show').textContent).toBe('false');
		expect(screen.getByTestId('install-can-trigger').textContent).toBe('false');
	});

	it('keeps dismissal session-safe even when localStorage is blocked', async () => {
		const originalSetItem = localStorage.setItem;
		localStorage.setItem = () => {
			throw new DOMException('Blocked', 'SecurityError');
		};

		try {
			await renderLayout();
			window.dispatchEvent(createBeforeInstallPromptEvent().event);
			flushSync();

			await fireEvent.click(screen.getByRole('button', { name: 'Dismiss install prompt' }));
			flushSync();

			expect(screen.getByTestId('install-dismissed').textContent).toBe('true');
			expect(screen.getByTestId('install-can-show').textContent).toBe('false');
		} finally {
			localStorage.setItem = originalSetItem;
		}
	});
});
