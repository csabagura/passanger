import { describe, it, expect, afterEach, vi } from 'vitest';
import {
	notifyDataChanged,
	notifySettingsChanged,
	notifyTabsRestored,
	subscribeTabSync,
	closeTabSync,
	type TabSyncMessage
} from './tabSync';
import { TAB_SYNC_CHANNEL } from '$lib/config';

afterEach(() => {
	closeTabSync();
});

describe('tabSync', () => {
	it('delivers each message kind to another tab', async () => {
		// A second raw channel on the same name simulates a different tab (a distinct instance).
		const otherTab = new BroadcastChannel(TAB_SYNC_CHANNEL);
		const received: TabSyncMessage[] = [];
		otherTab.onmessage = (e) => received.push(e.data as TabSyncMessage);

		notifyDataChanged();
		notifySettingsChanged();
		notifyTabsRestored();

		await vi.waitFor(() => expect(received).toHaveLength(3));
		expect(received).toEqual([{ kind: 'data' }, { kind: 'settings' }, { kind: 'restore' }]);

		otherTab.close();
	});

	it('does not notify the originating tab (singleton instance is shared by notify + subscribe)', async () => {
		const selfReceived: TabSyncMessage[] = [];
		const unsubscribe = subscribeTabSync((m) => selfReceived.push(m));

		// A separate instance proves the message WAS broadcast (so the empty self-list is the
		// no-self-notify guarantee, not a dropped message).
		const otherTab = new BroadcastChannel(TAB_SYNC_CHANNEL);
		const otherReceived: TabSyncMessage[] = [];
		otherTab.onmessage = (e) => otherReceived.push(e.data as TabSyncMessage);

		notifyDataChanged();

		await vi.waitFor(() => expect(otherReceived).toHaveLength(1));
		expect(selfReceived).toHaveLength(0);

		unsubscribe();
		otherTab.close();
	});

	it('only forwards well-formed messages to subscribers', async () => {
		const received: TabSyncMessage[] = [];
		const unsubscribe = subscribeTabSync((m) => received.push(m));

		const otherTab = new BroadcastChannel(TAB_SYNC_CHANNEL);
		otherTab.postMessage({ kind: 'bogus' });
		otherTab.postMessage('not-an-object');
		otherTab.postMessage({ kind: 'data' });

		await vi.waitFor(() => expect(received).toHaveLength(1));
		expect(received[0]).toEqual({ kind: 'data' });

		unsubscribe();
		otherTab.close();
	});

	it('does not throw and no-ops when BroadcastChannel is unavailable', () => {
		const original = globalThis.BroadcastChannel;
		// @ts-expect-error — simulate a browser/runtime without BroadcastChannel
		delete globalThis.BroadcastChannel;
		closeTabSync(); // reset cached singleton so getChannel re-evaluates availability

		expect(() => notifyDataChanged()).not.toThrow();
		const unsubscribe = subscribeTabSync(() => {});
		expect(typeof unsubscribe).toBe('function');
		expect(() => unsubscribe()).not.toThrow();

		globalThis.BroadcastChannel = original;
		closeTabSync();
	});
});
