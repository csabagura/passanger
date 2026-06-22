import { CAPTURE_DEEP_LINK_PARAM } from '$lib/config';
import type { CaptureSheetContext } from './captureSheet.svelte';

/**
 * The `?capture=fuel|expense` deep link (AC-3). Reads the param from a URL, opens the Capture sheet
 * on the matching segment, and hands back a cleaned URL (param removed) so the caller can strip it
 * via replaceState — so closing / reload / back doesn't re-trigger the sheet and the URL reflects
 * real state. Any other or absent value is a no-op.
 *
 * Extracted as a pure function (rather than inlining everything in the layout $effect) so it can be
 * unit-tested without rendering the whole root layout, which runs unrelated storage/theme effects.
 *
 * @returns true if a valid `?capture=` value was consumed.
 */
export function consumeCaptureDeepLink(
	url: URL,
	capture: Pick<CaptureSheetContext, 'openSheet'>,
	strip: (cleanedUrl: URL) => void
): boolean {
	const param = url.searchParams.get(CAPTURE_DEEP_LINK_PARAM);
	if (param !== 'fuel' && param !== 'expense') return false;

	// `param` is narrowed to CaptureMode ('fuel' | 'expense') by the guard above — no cast needed.
	capture.openSheet(param);

	const cleaned = new URL(url);
	cleaned.searchParams.delete(CAPTURE_DEEP_LINK_PARAM);
	strip(cleaned);

	return true;
}
