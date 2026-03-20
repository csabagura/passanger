import { ONBOARDING_SURVEY_STORAGE_KEY } from '$lib/config';

export type OnboardingSurveyResponse =
	| 'track-costs'
	| 'switching-app'
	| 'multiple-vehicles'
	| 'maintenance-reminders';

export interface OnboardingSurveyState {
	completed: boolean;
	dismissed: boolean;
	response?: OnboardingSurveyResponse;
}

interface OnboardingSurveyData {
	completed: boolean;
	dismissed: boolean;
	response?: OnboardingSurveyResponse;
	timestamp?: string;
}

const VALID_RESPONSES: readonly OnboardingSurveyResponse[] = [
	'track-costs',
	'switching-app',
	'multiple-vehicles',
	'maintenance-reminders'
] as const;

function isValidResponse(value: unknown): value is OnboardingSurveyResponse {
	return typeof value === 'string' && VALID_RESPONSES.includes(value as OnboardingSurveyResponse);
}

export function getOnboardingSurveyState(): OnboardingSurveyState {
	if (typeof localStorage === 'undefined') {
		return { completed: false, dismissed: false };
	}

	try {
		const raw = localStorage.getItem(ONBOARDING_SURVEY_STORAGE_KEY);
		if (!raw) return { completed: false, dismissed: false };

		const parsed = JSON.parse(raw) as unknown;
		if (!parsed || typeof parsed !== 'object') {
			return { completed: false, dismissed: false };
		}

		const data = parsed as Record<string, unknown>;
		const state: OnboardingSurveyState = {
			completed: data.completed === true,
			dismissed: data.dismissed === true
		};

		if (isValidResponse(data.response)) {
			state.response = data.response;
		}

		return state;
	} catch {
		return { completed: false, dismissed: false };
	}
}

export function saveOnboardingSurveyResponse(response: OnboardingSurveyResponse): boolean {
	if (typeof localStorage === 'undefined') return false;

	try {
		const data: OnboardingSurveyData = {
			completed: true,
			dismissed: false,
			response,
			timestamp: new Date().toISOString()
		};
		localStorage.setItem(ONBOARDING_SURVEY_STORAGE_KEY, JSON.stringify(data));
		return true;
	} catch {
		return false;
	}
}

export function dismissOnboardingSurvey(): boolean {
	if (typeof localStorage === 'undefined') return false;

	try {
		const data: OnboardingSurveyData = {
			completed: false,
			dismissed: true,
			timestamp: new Date().toISOString()
		};
		localStorage.setItem(ONBOARDING_SURVEY_STORAGE_KEY, JSON.stringify(data));
		return true;
	} catch {
		return false;
	}
}

export function shouldShowOnboardingSurvey(): boolean {
	const state = getOnboardingSurveyState();
	return !state.completed && !state.dismissed;
}
