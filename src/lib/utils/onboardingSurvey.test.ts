import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
	getOnboardingSurveyState,
	saveOnboardingSurveyResponse,
	dismissOnboardingSurvey,
	shouldShowOnboardingSurvey
} from './onboardingSurvey';
import { ONBOARDING_SURVEY_STORAGE_KEY } from '$lib/config';

beforeEach(() => {
	localStorage.clear();
});

describe('onboardingSurvey utilities', () => {
	describe('getOnboardingSurveyState()', () => {
		it('returns default state when localStorage is empty', () => {
			const state = getOnboardingSurveyState();
			expect(state).toEqual({ completed: false, dismissed: false });
		});

		it('returns completed state with response after save', () => {
			saveOnboardingSurveyResponse('track-costs');
			const state = getOnboardingSurveyState();
			expect(state.completed).toBe(true);
			expect(state.dismissed).toBe(false);
			expect(state.response).toBe('track-costs');
		});

		it('returns dismissed state after dismissal', () => {
			dismissOnboardingSurvey();
			const state = getOnboardingSurveyState();
			expect(state.completed).toBe(false);
			expect(state.dismissed).toBe(true);
			expect(state.response).toBeUndefined();
		});

		it('returns default state when stored JSON is invalid', () => {
			localStorage.setItem(ONBOARDING_SURVEY_STORAGE_KEY, 'not-valid-json{{{');
			const state = getOnboardingSurveyState();
			expect(state).toEqual({ completed: false, dismissed: false });
		});

		it('returns default state when stored value is not an object', () => {
			localStorage.setItem(ONBOARDING_SURVEY_STORAGE_KEY, JSON.stringify('string'));
			const state = getOnboardingSurveyState();
			expect(state).toEqual({ completed: false, dismissed: false });
		});

		it('returns default state when stored value is null JSON', () => {
			localStorage.setItem(ONBOARDING_SURVEY_STORAGE_KEY, JSON.stringify(null));
			const state = getOnboardingSurveyState();
			expect(state).toEqual({ completed: false, dismissed: false });
		});

		it('ignores invalid response value in stored data', () => {
			localStorage.setItem(
				ONBOARDING_SURVEY_STORAGE_KEY,
				JSON.stringify({ completed: true, dismissed: false, response: 'invalid-value' })
			);
			const state = getOnboardingSurveyState();
			expect(state.completed).toBe(true);
			expect(state.response).toBeUndefined();
		});

		it('treats non-boolean completed as false', () => {
			localStorage.setItem(
				ONBOARDING_SURVEY_STORAGE_KEY,
				JSON.stringify({ completed: 'yes', dismissed: false })
			);
			const state = getOnboardingSurveyState();
			expect(state.completed).toBe(false);
		});

		it('treats non-boolean dismissed as false', () => {
			localStorage.setItem(
				ONBOARDING_SURVEY_STORAGE_KEY,
				JSON.stringify({ completed: false, dismissed: 1 })
			);
			const state = getOnboardingSurveyState();
			expect(state.dismissed).toBe(false);
		});

		it('does not throw when localStorage.getItem throws', () => {
			const spy = vi.spyOn(Storage.prototype, 'getItem').mockImplementationOnce(() => {
				throw new DOMException('SecurityError', 'SecurityError');
			});
			const state = getOnboardingSurveyState();
			expect(state).toEqual({ completed: false, dismissed: false });
			spy.mockRestore();
		});
	});

	describe('saveOnboardingSurveyResponse()', () => {
		it('persists completed state with track-costs response', () => {
			expect(saveOnboardingSurveyResponse('track-costs')).toBe(true);
			const raw = localStorage.getItem(ONBOARDING_SURVEY_STORAGE_KEY);
			expect(raw).not.toBeNull();
			const parsed = JSON.parse(raw!);
			expect(parsed.completed).toBe(true);
			expect(parsed.dismissed).toBe(false);
			expect(parsed.response).toBe('track-costs');
			expect(parsed.timestamp).toBeDefined();
		});

		it('persists switching-app response', () => {
			saveOnboardingSurveyResponse('switching-app');
			const state = getOnboardingSurveyState();
			expect(state.response).toBe('switching-app');
		});

		it('persists multiple-vehicles response', () => {
			saveOnboardingSurveyResponse('multiple-vehicles');
			const state = getOnboardingSurveyState();
			expect(state.response).toBe('multiple-vehicles');
		});

		it('persists maintenance-reminders response', () => {
			saveOnboardingSurveyResponse('maintenance-reminders');
			const state = getOnboardingSurveyState();
			expect(state.response).toBe('maintenance-reminders');
		});

		it('returns false when localStorage.setItem throws QuotaExceededError', () => {
			const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementationOnce(() => {
				throw new DOMException('QuotaExceededError', 'QuotaExceededError');
			});
			expect(saveOnboardingSurveyResponse('track-costs')).toBe(false);
			spy.mockRestore();
		});

		it('returns false when localStorage.setItem throws SecurityError', () => {
			const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementationOnce(() => {
				throw new DOMException('SecurityError', 'SecurityError');
			});
			expect(saveOnboardingSurveyResponse('track-costs')).toBe(false);
			spy.mockRestore();
		});
	});

	describe('dismissOnboardingSurvey()', () => {
		it('persists dismissed state', () => {
			expect(dismissOnboardingSurvey()).toBe(true);
			const raw = localStorage.getItem(ONBOARDING_SURVEY_STORAGE_KEY);
			expect(raw).not.toBeNull();
			const parsed = JSON.parse(raw!);
			expect(parsed.completed).toBe(false);
			expect(parsed.dismissed).toBe(true);
			expect(parsed.response).toBeUndefined();
			expect(parsed.timestamp).toBeDefined();
		});

		it('returns false when localStorage.setItem throws', () => {
			const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementationOnce(() => {
				throw new DOMException('QuotaExceededError', 'QuotaExceededError');
			});
			expect(dismissOnboardingSurvey()).toBe(false);
			spy.mockRestore();
		});
	});

	describe('shouldShowOnboardingSurvey()', () => {
		it('returns true when survey has not been completed or dismissed', () => {
			expect(shouldShowOnboardingSurvey()).toBe(true);
		});

		it('returns false after survey is completed', () => {
			saveOnboardingSurveyResponse('track-costs');
			expect(shouldShowOnboardingSurvey()).toBe(false);
		});

		it('returns false after survey is dismissed', () => {
			dismissOnboardingSurvey();
			expect(shouldShowOnboardingSurvey()).toBe(false);
		});

		it('returns true when localStorage has invalid data', () => {
			localStorage.setItem(ONBOARDING_SURVEY_STORAGE_KEY, 'garbage');
			expect(shouldShowOnboardingSurvey()).toBe(true);
		});

		it('returns true when localStorage throws on read', () => {
			const spy = vi.spyOn(Storage.prototype, 'getItem').mockImplementationOnce(() => {
				throw new DOMException('SecurityError', 'SecurityError');
			});
			expect(shouldShowOnboardingSurvey()).toBe(true);
			spy.mockRestore();
		});
	});
});
