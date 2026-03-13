import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';
import NavBar from './NavBar.svelte';

let mockPathname = '/fuel-entry';
let mockBasePath = '';

vi.mock('$app/state', () => ({
	page: {
		get url() {
			return new URL(`http://localhost${mockPathname}`);
		}
	}
}));

vi.mock('$app/paths', () => ({
	resolve: (path: string) => mockBasePath + path
}));

describe('NavBar', () => {
	beforeEach(() => {
		mockPathname = '/fuel-entry';
		mockBasePath = '';
	});

	describe('rendering', () => {
		it('renders a nav with "Main navigation" label', () => {
			render(NavBar);
			const nav = screen.getByRole('navigation', { name: /main navigation/i });
			expect(nav).toBeTruthy();
		});

		it('renders 4 links with correct labels', () => {
			render(NavBar);
			const links = screen.getAllByRole('link');
			expect(links).toHaveLength(4);

			expect(screen.getByText('Fuel Entry')).toBeTruthy();
			expect(screen.getByText('Maintenance')).toBeTruthy();
			expect(screen.getByText('History')).toBeTruthy();
			expect(screen.getByText('Export')).toBeTruthy();
		});

		it('links point to correct routes', () => {
			render(NavBar);
			const links = screen.getAllByRole('link');
			expect(links[0].getAttribute('href')).toBe('/fuel-entry');
			expect(links[1].getAttribute('href')).toBe('/maintenance');
			expect(links[2].getAttribute('href')).toBe('/history');
			expect(links[3].getAttribute('href')).toBe('/export');
		});
	});

	describe('active state', () => {
		it('marks Fuel tab as current page on /fuel-entry', () => {
			mockPathname = '/fuel-entry';
			render(NavBar);
			const links = screen.getAllByRole('link');
			expect(links[0].getAttribute('aria-current')).toBe('page');
			expect(links[1].getAttribute('aria-current')).toBeNull();
			expect(links[2].getAttribute('aria-current')).toBeNull();
			expect(links[3].getAttribute('aria-current')).toBeNull();
		});

		it('marks Maintenance tab as current page on /maintenance', () => {
			mockPathname = '/maintenance';
			render(NavBar);
			const links = screen.getAllByRole('link');
			expect(links[0].getAttribute('aria-current')).toBeNull();
			expect(links[1].getAttribute('aria-current')).toBe('page');
		});

		it('marks History tab as current page on /history', () => {
			mockPathname = '/history';
			render(NavBar);
			const links = screen.getAllByRole('link');
			expect(links[2].getAttribute('aria-current')).toBe('page');
		});

		it('marks Export tab as current page on /export', () => {
			mockPathname = '/export';
			render(NavBar);
			const links = screen.getAllByRole('link');
			expect(links[3].getAttribute('aria-current')).toBe('page');
		});
	});

	describe('keyboard navigation', () => {
		it('ArrowRight moves focus to next link', () => {
			render(NavBar);
			const links = screen.getAllByRole('link');
			links[0].focus();

			fireEvent.keyDown(links[0], { key: 'ArrowRight' });
			expect(document.activeElement).toBe(links[1]);
		});

		it('ArrowRight wraps from last to first', () => {
			render(NavBar);
			const links = screen.getAllByRole('link');
			links[3].focus();

			fireEvent.keyDown(links[3], { key: 'ArrowRight' });
			expect(document.activeElement).toBe(links[0]);
		});

		it('ArrowLeft moves focus to previous link', () => {
			render(NavBar);
			const links = screen.getAllByRole('link');
			links[1].focus();

			fireEvent.keyDown(links[1], { key: 'ArrowLeft' });
			expect(document.activeElement).toBe(links[0]);
		});

		it('ArrowLeft wraps from first to last', () => {
			render(NavBar);
			const links = screen.getAllByRole('link');
			links[0].focus();

			fireEvent.keyDown(links[0], { key: 'ArrowLeft' });
			expect(document.activeElement).toBe(links[3]);
		});

		it('Home moves focus to first link', () => {
			render(NavBar);
			const links = screen.getAllByRole('link');
			links[2].focus();

			fireEvent.keyDown(links[2], { key: 'Home' });
			expect(document.activeElement).toBe(links[0]);
		});

		it('End moves focus to last link', () => {
			render(NavBar);
			const links = screen.getAllByRole('link');
			links[0].focus();

			fireEvent.keyDown(links[0], { key: 'End' });
			expect(document.activeElement).toBe(links[3]);
		});

		it('Space activates the focused link', () => {
			render(NavBar);
			const links = screen.getAllByRole('link');
			const clickSpy = vi.spyOn(links[1], 'click');
			links[1].focus();

			fireEvent.keyDown(links[1], { key: ' ' });
			expect(clickSpy).toHaveBeenCalledTimes(1);
		});
	});

	describe('active tab scroll-to-top (UX spec)', () => {
		it('scrolls to top instantly when clicking the already-active tab (NFR18 <=150ms)', () => {
			const scrollToSpy = vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
			mockPathname = '/fuel-entry';
			render(NavBar);
			const links = screen.getAllByRole('link');

			fireEvent.click(links[0]); // Fuel is active
			// `instant` is always used: completes in 0ms (satisfies NFR18 <= 150ms) and is
			// also the accessible default (no animation, no matchMedia check needed).
			expect(scrollToSpy).toHaveBeenCalledWith({ top: 0, behavior: 'instant' });
			scrollToSpy.mockRestore();
		});

		it('does not scroll when clicking an inactive tab', () => {
			const scrollToSpy = vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
			mockPathname = '/fuel-entry';
			render(NavBar);
			const links = screen.getAllByRole('link');

			fireEvent.click(links[1]); // Maintenance is inactive
			expect(scrollToSpy).not.toHaveBeenCalled();
			scrollToSpy.mockRestore();
		});

		it('scroll is instant regardless of prefers-reduced-motion (instant is already the accessible default)', () => {
			const scrollToSpy = vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
			// Even if matchMedia reports reduced-motion preference, behavior remains instant
			vi.stubGlobal('matchMedia', vi.fn().mockReturnValue({ matches: true } as MediaQueryList));

			mockPathname = '/fuel-entry';
			render(NavBar);
			const links = screen.getAllByRole('link');

			fireEvent.click(links[0]);
			expect(scrollToSpy).toHaveBeenCalledWith({ top: 0, behavior: 'instant' });

			scrollToSpy.mockRestore();
			vi.unstubAllGlobals();
		});

		it('prevents default navigation on active-tab click (scroll-only, no router side effect)', () => {
			// dispatchEvent returns false when the handler calls event.preventDefault()
			// on a cancelable event. This proves the SvelteKit router won't process the click.
			mockPathname = '/fuel-entry';
			render(NavBar);
			const links = screen.getAllByRole('link');

			const clickEvent = new MouseEvent('click', { bubbles: true, cancelable: true });
			const propagated = links[0].dispatchEvent(clickEvent); // Fuel is active
			expect(propagated).toBe(false); // false → preventDefault was called
		});

		it('does not prevent default navigation on inactive-tab click', () => {
			// Inactive tabs must still allow normal SvelteKit router navigation.
			mockPathname = '/fuel-entry';
			render(NavBar);
			const links = screen.getAllByRole('link');

			const clickEvent = new MouseEvent('click', { bubbles: true, cancelable: true });
			const propagated = links[1].dispatchEvent(clickEvent); // Maintenance is inactive
			expect(propagated).toBe(true); // true → preventDefault was NOT called
		});
	});

	describe('token contract (AC2 — active tab color must not drift)', () => {
		// AC2 specifies: active tab highlighted with --color-accent (#2563EB).
		// app.css @theme inline wires --color-accent → var(--primary) = #2563eb, so
		// text-accent resolves to the brand blue. NavBar uses text-accent for active tabs.
		// These tests lock the class contract so a future refactor cannot silently break AC2.
		it('active tab uses text-accent class (--color-accent: var(--primary) = #2563eb per app.css)', () => {
			mockPathname = '/fuel-entry';
			render(NavBar);
			const links = screen.getAllByRole('link');
			expect(links[0].className).toContain('text-accent');
		});

		it('inactive tabs use text-text-disabled class (--color-text-disabled: #9ca3af per app.css)', () => {
			mockPathname = '/fuel-entry';
			render(NavBar);
			const links = screen.getAllByRole('link');
			expect(links[1].className).toContain('text-text-disabled');
			expect(links[2].className).toContain('text-text-disabled');
			expect(links[3].className).toContain('text-text-disabled');
		});

		it('active class switches correctly when route changes', () => {
			mockPathname = '/maintenance';
			render(NavBar);
			const links = screen.getAllByRole('link');
			expect(links[1].className).toContain('text-accent');
			expect(links[0].className).toContain('text-text-disabled');
		});
	});

	describe('base-path support', () => {
		it('resolves hrefs with base path prefix', () => {
			mockBasePath = '/app';
			mockPathname = '/app/fuel-entry';
			render(NavBar);
			const links = screen.getAllByRole('link');
			expect(links[0].getAttribute('href')).toBe('/app/fuel-entry');
			expect(links[1].getAttribute('href')).toBe('/app/maintenance');
		});

		it('marks active tab correctly with base path', () => {
			mockBasePath = '/app';
			mockPathname = '/app/maintenance';
			render(NavBar);
			const links = screen.getAllByRole('link');
			expect(links[0].getAttribute('aria-current')).toBeNull();
			expect(links[1].getAttribute('aria-current')).toBe('page');
			expect(links[2].getAttribute('aria-current')).toBeNull();
			expect(links[3].getAttribute('aria-current')).toBeNull();
		});

		it('no tab is active when pathname does not match any resolved route', () => {
			mockBasePath = '/app';
			mockPathname = '/fuel-entry'; // Missing base path
			render(NavBar);
			const links = screen.getAllByRole('link');
			links.forEach((link) => {
				expect(link.getAttribute('aria-current')).toBeNull();
			});
		});
	});
});
