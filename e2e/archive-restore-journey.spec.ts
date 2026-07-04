import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

// Story 9.2 (Vehicle archive & restore, Dexie v7, ADR-008). Real-path e2e (AI-5.3): drive the actual
// Settings vehicle manager — archive a car (its history is retained, not destroyed), confirm it
// leaves the active set, restore it, then permanently delete it. Fresh context per test → empty
// IndexedDB → first-run wizard on Home.

const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];

async function onboardFirstVehicle(page: Page, name: string): Promise<void> {
	await page.goto('/');
	await page.waitForLoadState('networkidle');
	await page.getByRole('button', { name: /Add your vehicle to get started/i }).click();
	await expect(page.getByRole('heading', { name: 'Add your car' })).toBeVisible();

	await page.getByLabel('Display Name').fill(name);
	await page.getByLabel('Make').fill('Honda');
	await page.getByLabel('Model').fill('Civic');
	await page.getByRole('button', { name: 'Next' }).click();
	// Step 2 — units/currency defaults are fine.
	await page.getByRole('button', { name: 'Next' }).click();
	// Step 3 — no odometer / no presets needed.
	await page.getByRole('button', { name: 'Finish setup' }).click();

	// handleFinish saves the vehicle asynchronously and only calls onComplete (which UNMOUNTS the
	// wizard) AFTER saveVehicle resolves. The wizard's "Step N of M" label is present the whole time
	// it is open, so waiting for it to disappear is a real completion signal — without it the caller's
	// next page navigation (goto '/settings') can abort the in-flight save and silently drop the new
	// car, leaving it absent from the vehicle list. (The old "No vehicle yet" check was vacuous: that
	// heading is never shown while the wizard is open, so it passed before the save even started.)
	await expect(page.getByText(/step \d+ of \d+/i)).toHaveCount(0);
	await expect(page.getByRole('heading', { name: 'No vehicle yet' })).toHaveCount(0);
}

async function addVehicleViaSettings(page: Page, name: string): Promise<void> {
	await page.goto('/settings');
	await page.waitForLoadState('networkidle');
	await page.getByRole('button', { name: /add vehicle/i }).click();
	await page.getByLabel('Display Name').fill(name);
	await page.getByLabel('Make').fill('Ford');
	await page.getByLabel('Model').fill('Focus');
	await page.getByRole('button', { name: /save vehicle/i }).click();
	await expect(page.getByRole('list', { name: /vehicle list/i }).getByText(name)).toBeVisible();
}

test('archive keeps the car (retained + restorable), restore brings it back, permanent-delete removes it', async ({
	page
}) => {
	await onboardFirstVehicle(page, 'Alpha');
	await addVehicleViaSettings(page, 'Beta');

	const activeList = page.getByRole('list', { name: /^vehicle list$/i });
	await expect(activeList.getByText('Alpha')).toBeVisible();
	await expect(activeList.getByText('Beta')).toBeVisible();

	// --- Archive Alpha (the default destructive action) -----------------------------------------
	await page.getByRole('button', { name: /archive alpha/i }).click();
	await expect(page.getByRole('alertdialog')).toBeVisible();
	await expect(page.getByText(/history and odometer are kept/i)).toBeVisible();
	await page.getByRole('button', { name: /confirm archive/i }).click();

	// Alpha left the active list and now lives under Archived.
	await expect(activeList.getByText('Alpha')).toHaveCount(0);
	const archivedList = page.getByRole('list', { name: /archived vehicles/i });
	await expect(archivedList.getByText('Alpha')).toBeVisible();

	// The app remains functional after re-pointing the active vehicle (S19) — Settings still renders.
	await expect(page.getByRole('heading', { name: 'Vehicles' })).toBeVisible();

	// --- Restore Alpha --------------------------------------------------------------------------
	await page.getByRole('button', { name: /restore alpha/i }).click();
	await expect(activeList.getByText('Alpha')).toBeVisible();
	await expect(page.getByRole('list', { name: /archived vehicles/i })).toHaveCount(0);

	// --- Archive again, then permanently delete (the only data-destroying path) ------------------
	await page.getByRole('button', { name: /archive alpha/i }).click();
	await page.getByRole('button', { name: /confirm archive/i }).click();
	await expect(
		page.getByRole('list', { name: /archived vehicles/i }).getByText('Alpha')
	).toBeVisible();

	await page.getByRole('button', { name: /delete alpha permanently/i }).click();
	await expect(page.getByText(/can't be undone/i)).toBeVisible();
	await page.getByRole('button', { name: /^delete permanently$/i }).click();

	// Gone from both lists — the cascade purge ran.
	await expect(page.getByText('Alpha')).toHaveCount(0);
	await expect(activeList.getByText('Beta')).toBeVisible();
});

test('archived section has no critical/serious WCAG 2.1 AA violations', async ({ page }) => {
	await onboardFirstVehicle(page, 'Alpha');
	await addVehicleViaSettings(page, 'Beta');

	await page.getByRole('button', { name: /archive alpha/i }).click();
	await page.getByRole('button', { name: /confirm archive/i }).click();
	await expect(page.getByRole('list', { name: /archived vehicles/i })).toBeVisible();

	const results = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
	const serious = results.violations.filter(
		(v) => v.impact === 'critical' || v.impact === 'serious'
	);
	expect(serious, JSON.stringify(serious, null, 2)).toEqual([]);
});
