import { INSTALL_PROMPT_DISMISSED_KEY, SESSION_COUNT_STORAGE_KEY } from '$lib/config';

export interface BeforeInstallPromptChoice {
	outcome: 'accepted' | 'dismissed';
	platform: string;
}

export interface BeforeInstallPromptEvent extends Event {
	prompt(): Promise<void>;
	userChoice: Promise<BeforeInstallPromptChoice>;
}

export type InstallPromptPlatform = 'android' | 'ios' | 'unsupported';
export type InstallPromptRequestOutcome = 'accepted' | 'dismissed' | 'unavailable';

export interface InstallPromptContext {
	get platform(): InstallPromptPlatform;
	get isStandalone(): boolean;
	get isDismissed(): boolean;
	get canShowPrompt(): boolean;
	get canTriggerNativeInstall(): boolean;
	dismissPrompt(): void;
	requestInstall(): Promise<InstallPromptRequestOutcome>;
}

function safeGetItem(key: string): string | null {
	try {
		return localStorage.getItem(key);
	} catch {
		return null;
	}
}

function safeSetItem(key: string, value: string): void {
	try {
		localStorage.setItem(key, value);
	} catch {
		// localStorage is optional for this feature; session fallback lives in shell state
	}
}

export function hasInstallPromptBeenDismissed(): boolean {
	return safeGetItem(INSTALL_PROMPT_DISMISSED_KEY) === 'true';
}

export function markInstallPromptDismissed(): void {
	safeSetItem(INSTALL_PROMPT_DISMISSED_KEY, 'true');
}

export function isStandaloneDisplayMode(target: Window = window): boolean {
	if (typeof target.matchMedia !== 'function') {
		return false;
	}

	return target.matchMedia('(display-mode: standalone)').matches;
}

export function getSessionCount(): number {
	const raw = safeGetItem(SESSION_COUNT_STORAGE_KEY);
	if (raw === null) return 0;
	const parsed = parseInt(raw, 10);
	return Number.isNaN(parsed) ? 0 : parsed;
}

export function incrementSessionCount(): number {
	const next = getSessionCount() + 1;
	safeSetItem(SESSION_COUNT_STORAGE_KEY, String(next));
	return next;
}

export function isSecondOrLaterSession(): boolean {
	return getSessionCount() >= 2;
}

export function getInstallPromptPlatform(target: Navigator = navigator): InstallPromptPlatform {
	const userAgent = target.userAgent ?? '';
	const isAppleTouchDevice =
		/iPad|iPhone|iPod/i.test(userAgent) ||
		(target.platform === 'MacIntel' && (target.maxTouchPoints ?? 0) > 1);
	const isSafari = /Safari/i.test(userAgent) && !/CriOS|FxiOS|EdgiOS|OPiOS|OPT\//i.test(userAgent);

	if (isAppleTouchDevice && isSafari) {
		return 'ios';
	}

	if (/Android/i.test(userAgent)) {
		return 'android';
	}

	return 'unsupported';
}
