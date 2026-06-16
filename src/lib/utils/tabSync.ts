import { TAB_SYNC_CHANNEL } from '$lib/config';

// Cross-tab reconciliation signal layer.
//
// A single same-origin BroadcastChannel per tab. After a committed change a tab posts a typed
// message; OTHER tabs re-run their existing imperative loads. BroadcastChannel makes no network
// call, so the `connect-src 'none'` privacy contract is untouched. A BroadcastChannel never
// delivers a message to the instance that posted it, and notify + subscribe share ONE singleton
// instance per tab, so the originating tab never self-notifies.

export type TabSyncKind = 'data' | 'settings' | 'restore';

export interface TabSyncMessage {
	kind: TabSyncKind;
}

let channel: BroadcastChannel | null = null;
let unavailable = false;

function getChannel(): BroadcastChannel | null {
	if (unavailable) return null;
	if (channel) return channel;
	if (typeof BroadcastChannel === 'undefined') {
		unavailable = true;
		return null;
	}
	channel = new BroadcastChannel(TAB_SYNC_CHANNEL);
	// In Node (vitest) an open BroadcastChannel keeps the event loop alive and can block process
	// exit. unref() exists only on Node's implementation — optional-chain so the browser's
	// BroadcastChannel (which has no unref) is unaffected.
	(channel as unknown as { unref?: () => void }).unref?.();
	return channel;
}

function post(kind: TabSyncKind): void {
	getChannel()?.postMessage({ kind } satisfies TabSyncMessage);
}

function isTabSyncKind(value: unknown): value is TabSyncKind {
	return value === 'data' || value === 'settings' || value === 'restore';
}

// Emitted on every committed DB mutation (manual CRUD + CSV import). Receivers refetch live data.
export function notifyDataChanged(): void {
	post('data');
}

// Emitted when the user changes settings (units / currency / theme / rates). Receivers re-read them.
export function notifySettingsChanged(): void {
	post('settings');
}

// Emitted when a backup restore has replaced the whole DB. Receivers prompt for a reload.
// Posted before the caller's location.reload(); BroadcastChannel dispatches a posted message
// independently of the sender's navigation, so other tabs still receive it after this tab reloads.
export function notifyTabsRestored(): void {
	post('restore');
}

// Subscribe to messages from OTHER tabs. Returns a cleanup function. No-op (cleanup is a no-op)
// when BroadcastChannel is unavailable.
export function subscribeTabSync(handler: (message: TabSyncMessage) => void): () => void {
	const ch = getChannel();
	if (!ch) return () => {};

	const listener = (event: MessageEvent) => {
		const kind = (event.data as { kind?: unknown } | null)?.kind;
		if (isTabSyncKind(kind)) {
			handler({ kind });
		}
	};

	ch.addEventListener('message', listener);
	return () => ch.removeEventListener('message', listener);
}

// Closes and forgets the singleton so a fresh channel is created on next use. Primarily for tests
// (prevents an open handle from leaking between cases / blocking the runner).
export function closeTabSync(): void {
	channel?.close();
	channel = null;
	unavailable = false;
}
