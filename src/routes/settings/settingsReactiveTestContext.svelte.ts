import type { AppSettings } from '$lib/utils/settings';

// Test-only helper: a REAL $state-backed 'settings' context, mirroring +layout.svelte's actual
// shape. settings-page.test.ts's other context mock uses a plain (non-reactive) object, which
// cannot exercise S28's re-sync-on-remote-change effect — Svelte's dependency tracking only
// fires on reads of an actual reactive source, not a plain getter over a mutable closure variable.
export function createReactiveSettingsContext(initial: AppSettings) {
	let settings = $state<AppSettings>(initial);
	return {
		get settings() {
			return settings;
		},
		updateSettings(next: AppSettings) {
			settings = next;
		},
		/** Test-only: simulate a remote tab's settings write reaching this tab. */
		setRemote(next: AppSettings) {
			settings = next;
		}
	};
}
