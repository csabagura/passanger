import { describe, it, expect, vi } from 'vitest';
import { cleanup, render, screen, fireEvent } from '@testing-library/svelte';
import OnboardingSurvey from './OnboardingSurvey.svelte';

describe('OnboardingSurvey', () => {
	it('renders the survey with complementary semantics', () => {
		render(OnboardingSurvey, {
			props: { onSubmit: vi.fn(), onDismiss: vi.fn() }
		});

		const survey = screen.getByRole('complementary', { name: /onboarding survey/i });
		expect(survey).toBeTruthy();
	});

	it('renders the question text', () => {
		render(OnboardingSurvey, {
			props: { onSubmit: vi.fn(), onDismiss: vi.fn() }
		});

		expect(screen.getByText('What brings you to passanger?')).toBeTruthy();
	});

	it('renders exactly 4 radio options', () => {
		render(OnboardingSurvey, {
			props: { onSubmit: vi.fn(), onDismiss: vi.fn() }
		});

		const radios = screen.getAllByRole('radio');
		expect(radios).toHaveLength(4);
	});

	it('renders the correct option labels', () => {
		render(OnboardingSurvey, {
			props: { onSubmit: vi.fn(), onDismiss: vi.fn() }
		});

		expect(screen.getByText('Track my costs')).toBeTruthy();
		expect(screen.getByText('Switching from another app')).toBeTruthy();
		expect(screen.getByText('Manage multiple vehicles')).toBeTruthy();
		expect(screen.getByText('Maintenance reminders')).toBeTruthy();
	});

	it('renders a radiogroup with accessible label', () => {
		render(OnboardingSurvey, {
			props: { onSubmit: vi.fn(), onDismiss: vi.fn() }
		});

		const radiogroup = screen.getByRole('radiogroup', {
			name: /why are you using passanger/i
		});
		expect(radiogroup).toBeTruthy();
	});

	it('has all radio options unchecked by default', () => {
		render(OnboardingSurvey, {
			props: { onSubmit: vi.fn(), onDismiss: vi.fn() }
		});

		const radios = screen.getAllByRole('radio');
		radios.forEach((radio) => {
			expect(radio.getAttribute('aria-checked')).toBe('false');
		});
	});

	it('toggles aria-checked when an option is clicked', async () => {
		render(OnboardingSurvey, {
			props: { onSubmit: vi.fn(), onDismiss: vi.fn() }
		});

		const radios = screen.getAllByRole('radio');
		await fireEvent.click(radios[0]);
		expect(radios[0].getAttribute('aria-checked')).toBe('true');
		expect(radios[1].getAttribute('aria-checked')).toBe('false');
	});

	it('switching selection updates aria-checked correctly', async () => {
		render(OnboardingSurvey, {
			props: { onSubmit: vi.fn(), onDismiss: vi.fn() }
		});

		const radios = screen.getAllByRole('radio');
		await fireEvent.click(radios[0]);
		expect(radios[0].getAttribute('aria-checked')).toBe('true');

		await fireEvent.click(radios[2]);
		expect(radios[0].getAttribute('aria-checked')).toBe('false');
		expect(radios[2].getAttribute('aria-checked')).toBe('true');
	});

	it('submit button is disabled when no option is selected', () => {
		render(OnboardingSurvey, {
			props: { onSubmit: vi.fn(), onDismiss: vi.fn() }
		});

		const submitBtn = screen.getByRole('button', { name: 'Submit' });
		expect(submitBtn.hasAttribute('disabled')).toBe(true);
	});

	it('submit button is enabled after selecting an option', async () => {
		render(OnboardingSurvey, {
			props: { onSubmit: vi.fn(), onDismiss: vi.fn() }
		});

		const radios = screen.getAllByRole('radio');
		await fireEvent.click(radios[0]);

		const submitBtn = screen.getByRole('button', { name: 'Submit' });
		expect(submitBtn.hasAttribute('disabled')).toBe(false);
	});

	it('calls onSubmit with selected response on submit', async () => {
		const onSubmit = vi.fn();
		render(OnboardingSurvey, {
			props: { onSubmit, onDismiss: vi.fn() }
		});

		const radios = screen.getAllByRole('radio');
		await fireEvent.click(radios[0]); // track-costs
		await fireEvent.click(screen.getByRole('button', { name: 'Submit' }));

		expect(onSubmit).toHaveBeenCalledWith('track-costs');
	});

	it('calls onSubmit with multiple-vehicles response', async () => {
		const onSubmit = vi.fn();
		render(OnboardingSurvey, {
			props: { onSubmit, onDismiss: vi.fn() }
		});

		const radios = screen.getAllByRole('radio');
		await fireEvent.click(radios[2]); // multiple-vehicles
		await fireEvent.click(screen.getByRole('button', { name: 'Submit' }));

		expect(onSubmit).toHaveBeenCalledWith('multiple-vehicles');
	});

	it('calls onDismiss when Skip is clicked', async () => {
		const onDismiss = vi.fn();
		render(OnboardingSurvey, {
			props: { onSubmit: vi.fn(), onDismiss }
		});

		await fireEvent.click(screen.getByRole('button', { name: 'Skip' }));
		expect(onDismiss).toHaveBeenCalledOnce();
	});

	it('shows Import hint when switching-app is selected and submitted', async () => {
		vi.useFakeTimers();
		const onSubmit = vi.fn();
		render(OnboardingSurvey, {
			props: { onSubmit, onDismiss: vi.fn() }
		});

		const radios = screen.getAllByRole('radio');
		await fireEvent.click(radios[1]); // switching-app
		await fireEvent.click(screen.getByRole('button', { name: 'Submit' }));

		expect(screen.getByText(/import data/i)).toBeTruthy();
		expect(onSubmit).not.toHaveBeenCalled();

		vi.advanceTimersByTime(3000);
		expect(onSubmit).toHaveBeenCalledWith('switching-app');
		vi.useRealTimers();
	});

	it('navigates options with ArrowDown key', async () => {
		render(OnboardingSurvey, {
			props: { onSubmit: vi.fn(), onDismiss: vi.fn() }
		});

		const radiogroup = screen.getByRole('radiogroup');
		const radios = screen.getAllByRole('radio');

		// Select first option first
		await fireEvent.click(radios[0]);
		expect(radios[0].getAttribute('aria-checked')).toBe('true');

		// ArrowDown should move to next
		await fireEvent.keyDown(radiogroup, { key: 'ArrowDown' });
		expect(radios[1].getAttribute('aria-checked')).toBe('true');
		expect(radios[0].getAttribute('aria-checked')).toBe('false');
	});

	it('navigates options with ArrowUp key', async () => {
		render(OnboardingSurvey, {
			props: { onSubmit: vi.fn(), onDismiss: vi.fn() }
		});

		const radiogroup = screen.getByRole('radiogroup');
		const radios = screen.getAllByRole('radio');

		// Select second option first
		await fireEvent.click(radios[1]);
		expect(radios[1].getAttribute('aria-checked')).toBe('true');

		// ArrowUp should move to previous
		await fireEvent.keyDown(radiogroup, { key: 'ArrowUp' });
		expect(radios[0].getAttribute('aria-checked')).toBe('true');
		expect(radios[1].getAttribute('aria-checked')).toBe('false');
	});

	it('wraps from last to first with ArrowDown', async () => {
		render(OnboardingSurvey, {
			props: { onSubmit: vi.fn(), onDismiss: vi.fn() }
		});

		const radiogroup = screen.getByRole('radiogroup');
		const radios = screen.getAllByRole('radio');

		await fireEvent.click(radios[3]); // last option
		await fireEvent.keyDown(radiogroup, { key: 'ArrowDown' });
		expect(radios[0].getAttribute('aria-checked')).toBe('true');
	});

	it('wraps from first to last with ArrowUp', async () => {
		render(OnboardingSurvey, {
			props: { onSubmit: vi.fn(), onDismiss: vi.fn() }
		});

		const radiogroup = screen.getByRole('radiogroup');
		const radios = screen.getAllByRole('radio');

		await fireEvent.click(radios[0]); // first option
		await fireEvent.keyDown(radiogroup, { key: 'ArrowUp' });
		expect(radios[3].getAttribute('aria-checked')).toBe('true');
	});

	it('cleans up migration hint timer on component destroy', async () => {
		vi.useFakeTimers();
		const onSubmit = vi.fn();
		render(OnboardingSurvey, {
			props: { onSubmit, onDismiss: vi.fn() }
		});

		const radios = screen.getAllByRole('radio');
		await fireEvent.click(radios[1]); // switching-app
		await fireEvent.click(screen.getByRole('button', { name: 'Submit' }));

		// Timer started but component destroyed before it fires
		cleanup();
		vi.advanceTimersByTime(3000);

		expect(onSubmit).not.toHaveBeenCalled();
		vi.useRealTimers();
	});

	it('Skip button meets 44px minimum touch target (NFR10)', () => {
		render(OnboardingSurvey, {
			props: { onSubmit: vi.fn(), onDismiss: vi.fn() }
		});

		const skipBtn = screen.getByRole('button', { name: 'Skip' });
		expect(skipBtn.className).toContain('min-h-11');
	});

	it('uses token-backed classes instead of hard-coded colors', () => {
		render(OnboardingSurvey, {
			props: { onSubmit: vi.fn(), onDismiss: vi.fn() }
		});

		const survey = screen.getByRole('complementary', { name: /onboarding survey/i });
		expect(survey.className).toContain('bg-card');
		expect(survey.className).toContain('border-border');
		expect(survey.className).not.toContain('#');
	});
});
