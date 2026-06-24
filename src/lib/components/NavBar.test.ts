import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';
import NavBar from './NavBar.svelte';

let mockPathname = '/';
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
		mockPathname = '/';
		mockBasePath = '';
	});

	describe('rendering (DEC-1 5-item model: Home · Understand · [FAB] · History · Maintain)', () => {
		it('renders a nav with "Main navigation" label', () => {
			render(NavBar);
			const nav = screen.getByRole('navigation', { name: /main navigation/i });
			expect(nav).toBeTruthy();
		});

		it('renders 4 links (the FAB centre slot is not a link)', () => {
			render(NavBar);
			const links = screen.getAllByRole('link');
			expect(links).toHaveLength(4);

			expect(screen.getByText('Home')).toBeTruthy();
			expect(screen.getByText('Understand')).toBeTruthy();
			expect(screen.getByText('History')).toBeTruthy();
			expect(screen.getByText('Maintain')).toBeTruthy();
		});

		it('links point to correct routes (Understand→/understand, Maintain→/maintain)', () => {
			render(NavBar);
			const links = screen.getAllByRole('link');
			expect(links[0].getAttribute('href')).toBe('/');
			expect(links[1].getAttribute('href')).toBe('/understand');
			expect(links[2].getAttribute('href')).toBe('/history');
			expect(links[3].getAttribute('href')).toBe('/maintain');
		});
	});

	describe('active state', () => {
		it('marks Home tab as current page on /', () => {
			mockPathname = '/';
			render(NavBar);
			const links = screen.getAllByRole('link');
			expect(links[0].getAttribute('aria-current')).toBe('page');
			expect(links[1].getAttribute('aria-current')).toBeNull();
			expect(links[2].getAttribute('aria-current')).toBeNull();
			expect(links[3].getAttribute('aria-current')).toBeNull();
		});

		it('marks Understand tab as current page on /understand', () => {
			mockPathname = '/understand';
			render(NavBar);
			const links = screen.getAllByRole('link');
			expect(links[1].getAttribute('aria-current')).toBe('page');
		});

		it('marks History tab as current page on /history', () => {
			mockPathname = '/history';
			render(NavBar);
			const links = screen.getAllByRole('link');
			expect(links[2].getAttribute('aria-current')).toBe('page');
		});

		it('marks Maintain tab as current page on /maintain', () => {
			mockPathname = '/maintain';
			render(NavBar);
			const links = screen.getAllByRole('link');
			expect(links[3].getAttribute('aria-current')).toBe('page');
		});
	});

	describe('keyboard navigation (arrow nav iterates the 4 links, skipping the FAB slot)', () => {
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
			mockPathname = '/';
			render(NavBar);
			const links = screen.getAllByRole('link');

			fireEvent.click(links[0]); // Home is active
			expect(scrollToSpy).toHaveBeenCalledWith({ top: 0, behavior: 'instant' });
			scrollToSpy.mockRestore();
		});

		it('does not scroll when clicking an inactive tab', () => {
			const scrollToSpy = vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
			mockPathname = '/';
			render(NavBar);
			const links = screen.getAllByRole('link');

			fireEvent.click(links[2]); // History is inactive
			expect(scrollToSpy).not.toHaveBeenCalled();
			scrollToSpy.mockRestore();
		});

		it('scroll is instant regardless of prefers-reduced-motion (instant is already the accessible default)', () => {
			const scrollToSpy = vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
			vi.stubGlobal('matchMedia', vi.fn().mockReturnValue({ matches: true } as MediaQueryList));

			mockPathname = '/';
			render(NavBar);
			const links = screen.getAllByRole('link');

			fireEvent.click(links[0]);
			expect(scrollToSpy).toHaveBeenCalledWith({ top: 0, behavior: 'instant' });

			scrollToSpy.mockRestore();
			vi.unstubAllGlobals();
		});

		it('prevents default navigation on active-tab click (scroll-only, no router side effect)', () => {
			mockPathname = '/';
			render(NavBar);
			const links = screen.getAllByRole('link');

			const clickEvent = new MouseEvent('click', { bubbles: true, cancelable: true });
			const propagated = links[0].dispatchEvent(clickEvent); // Home is active
			expect(propagated).toBe(false); // false → preventDefault was called
		});

		it('does not prevent default navigation on inactive-tab click', () => {
			mockPathname = '/';
			render(NavBar);
			const links = screen.getAllByRole('link');

			const clickEvent = new MouseEvent('click', { bubbles: true, cancelable: true });
			const propagated = links[2].dispatchEvent(clickEvent); // History is inactive
			expect(propagated).toBe(true); // true → preventDefault was NOT called
		});
	});

	describe('token contract (AC2 — active tab color must not drift)', () => {
		it('active tab uses text-accent class (--color-accent: var(--primary) = #2563eb per app.css)', () => {
			mockPathname = '/';
			render(NavBar);
			const links = screen.getAllByRole('link');
			expect(links[0].className).toContain('text-accent');
		});

		it('inactive tabs use text-text-disabled class (--color-text-disabled: #9ca3af per app.css)', () => {
			mockPathname = '/';
			render(NavBar);
			const links = screen.getAllByRole('link');
			expect(links[1].className).toContain('text-text-disabled');
			expect(links[2].className).toContain('text-text-disabled');
			expect(links[3].className).toContain('text-text-disabled');
		});

		it('active class switches correctly when route changes', () => {
			mockPathname = '/history';
			render(NavBar);
			const links = screen.getAllByRole('link');
			expect(links[2].className).toContain('text-accent');
			expect(links[0].className).toContain('text-text-disabled');
		});
	});

	describe('base-path support', () => {
		it('resolves hrefs with base path prefix', () => {
			mockBasePath = '/app';
			mockPathname = '/app/';
			render(NavBar);
			const links = screen.getAllByRole('link');
			expect(links[0].getAttribute('href')).toBe('/app/');
			expect(links[2].getAttribute('href')).toBe('/app/history');
		});

		it('marks active tab correctly with base path', () => {
			mockBasePath = '/app';
			mockPathname = '/app/history';
			render(NavBar);
			const links = screen.getAllByRole('link');
			expect(links[0].getAttribute('aria-current')).toBeNull();
			expect(links[2].getAttribute('aria-current')).toBe('page');
		});

		it('no tab is active when pathname does not match any resolved route', () => {
			mockBasePath = '/app';
			mockPathname = '/history'; // Missing base path
			render(NavBar);
			const links = screen.getAllByRole('link');
			links.forEach((link) => {
				expect(link.getAttribute('aria-current')).toBeNull();
			});
		});
	});
});
