import { describe, it, expect, afterEach, vi } from 'vitest';
import {
	notifyDataChanged,
	notifySettingsChanged,
	notifyTabsRestored,
	subscribeTabSync,
	closeTabSync,
	getDataGeneration,
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

	it('strictly increases the local data generation after each notifyDataChanged (AC4)', () => {
		const before = getDataGeneration();
		notifyDataChanged();
		const afterFirst = getDataGeneration();
		notifyDataChanged();
		const afterSecond = getDataGeneration();

		expect(afterFirst).toBeGreaterThan(before);
		expect(afterSecond).toBeGreaterThan(afterFirst);
	});

	it('models the undo guard against the real counter: only data writes flip a captured generation (AC4)', () => {
		// Exercise the exact comparison the History undo guard performs, against the REAL counter
		// (no mock on either side) so the bump-and-guard plumbing is covered end-to-end.
		const captured = getDataGeneration();

		// Non-data notifications must NOT invalidate a pending undo.
		notifySettingsChanged();
		notifyTabsRestored();
		expect(getDataGeneration() === captured).toBe(true);

		// A committed data write must invalidate it.
		notifyDataChanged();
		expect(getDataGeneration() === captured).toBe(false);
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
