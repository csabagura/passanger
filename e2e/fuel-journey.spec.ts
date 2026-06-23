import { test, expect, type Page } from '@playwright/test';

// Each Playwright test runs in a fresh browser context, so IndexedDB starts empty and
// every journey begins at the first-run (no vehicle) state on /log.

async function createVehicle(page: Page, name: string): Promise<void> {
	await page.goto('/log');
	await page.waitForLoadState('networkidle');

	// First-run state: an onboarding region prompts the user to add a vehicle.
	await expect(page.getByRole('heading', { name: 'No vehicle yet' })).toBeVisible();
	await page.getByRole('button', { name: /Add your vehicle to get started/i }).click();

	// The inline VehicleForm appears in place of the onboarding prompt.
	await page.getByLabel('Display Name').fill(name);
	await page.getByLabel('Make').fill('Toyota');
	await page.getByLabel('Model').fill('Corolla');
	await page.getByRole('button', { name: 'Save vehicle' }).click();

	// After saving, the fuel/service log mode switcher is shown for the new vehicle.
	await expect(page.getByRole('radiogroup', { name: 'Log mode' })).toBeVisible();
}

async function addFuelLog(
	page: Page,
	values: { odometer: string; quantity: string; cost: string }
): Promise<void> {
	// Ensure the fuel tab is active (it is the default).
	const fuelRadio = page.getByRole('radio', { name: 'Fuel' });
	if ((await fuelRadio.getAttribute('aria-checked')) !== 'true') {
		await fuelRadio.click();
	}

	await page.getByLabel(/^Odometer/).fill(values.odometer);
	await page.getByLabel(/^Quantity/).fill(values.quantity);
	await page.getByLabel('Total Cost').fill(values.cost);
	await page.getByRole('button', { name: 'Save', exact: true }).click();

	// The form surfaces an inline success result card after a successful save.
	await expect(page.getByRole('status').filter({ hasText: /Saved|log one more/i })).toBeVisible();
}

async function gotoHistory(page: Page): Promise<void> {
	await page
		.getByRole('navigation', { name: 'Main navigation' })
		.getByRole('link', { name: 'History' })
		.click();
	await page.waitForLoadState('networkidle');
	// The page body has its own <h1>History</h1>; the app header also shows the page title,
	// so scope to <main> to disambiguate.
	await expect(
		page.getByRole('main').getByRole('heading', { name: 'History', level: 1 })
	).toBeVisible();
}

// The list of entry cards (scoped away from the stat bar, which also renders amounts).
function entriesList(page: Page) {
	return page.getByRole('list', { name: /History entries for/ });
}

// The "Total spend" figure inside the stat bar.
function totalSpendValue(page: Page) {
	return page
		.getByRole('region', { name: 'History totals' })
		.locator('div', { has: page.getByText('Total spend') })
		.locator('dd');
}

// Open the first history entry's detail sheet. The card wraps the detail button in a
// swipe-gesture container that sets pointer capture on pointerdown, which can swallow the
// synthesized `click` from a normal Playwright click. Dispatching the click event directly
// invokes the button's own onclick handler (the same path a tap/Enter uses) reliably.
async function openFirstEntryDetail(page: Page) {
	await page
		.getByRole('button', { name: /View details for fuel entry/i })
		.first()
		.dispatchEvent('click');
	return page.getByRole('dialog', { name: 'Entry details' });
}

test('fuel lifecycle: create vehicle, add logs, view, edit cost, delete', async ({ page }) => {
	await createVehicle(page, 'Daily Driver');

	// Two fuel logs (ascending odometers) so the second entry computes consumption.
	await addFuelLog(page, { odometer: '10000', quantity: '40', cost: '60' });
	await addFuelLog(page, { odometer: '10500', quantity: '42', cost: '78' });

	await gotoHistory(page);

	// The history list shows both entries; assert the costs are present (default € currency).
	await expect(entriesList(page).getByText('€78.00')).toBeVisible();
	await expect(entriesList(page).getByText('€60.00')).toBeVisible();

	// The stat bar reflects the summed spend for the current month (both entries = 138).
	await expect(totalSpendValue(page)).toHaveText('€138.00');

	// Open the most recent entry's detail sheet (the €78 fill-up at odometer 10500).
	const sheet = await openFirstEntryDetail(page);
	await expect(sheet).toBeVisible();
	// The detail sheet shows the cost and the computed consumption:
	// (42 L / 500 km) * 100 = 8.4 L/100km.
	await expect(sheet.getByText('€78.00')).toBeVisible();
	await expect(sheet.getByText('8.4 L/100km')).toBeVisible();

	// Edit it: change the cost from 78 to 90.
	await sheet.getByRole('button', { name: 'Edit', exact: true }).click();
	await expect(page.getByRole('heading', { name: 'Editing fuel entry' })).toBeVisible();

	const costInput = page.getByLabel('Total Cost');
	await expect(costInput).toHaveValue('78');
	await costInput.fill('90');
	await page.getByRole('button', { name: 'Save changes' }).click();

	// The success card confirms the update; the history list now shows the new cost.
	await expect(page.getByRole('status').filter({ hasText: /Updated/i })).toBeVisible();
	await expect(entriesList(page).getByText('€90.00')).toBeVisible();
	await expect(entriesList(page).getByText('€78.00')).toHaveCount(0);

	// The stat bar now sums to 60 + 90 = 150.
	await expect(totalSpendValue(page)).toHaveText('€150.00');

	// Story 2.4: the confirmation persists until dismissed — tapping Done closes the edit form.
	await page.getByRole('button', { name: 'Done', exact: true }).click();
	await expect(page.getByRole('heading', { name: 'Editing fuel entry' })).toHaveCount(0);

	// Delete the edited entry via its detail sheet — a single action, no confirm dialog (FR-7).
	const sheetForDelete = await openFirstEntryDetail(page);
	await expect(sheetForDelete.getByText('€90.00')).toBeVisible();
	await sheetForDelete.getByRole('button', { name: /Delete fuel entry/i }).click();

	// The entry disappears immediately and an Undo action toast appears (~5s window).
	await expect(entriesList(page).getByText('€90.00')).toHaveCount(0);
	await expect(page.getByText('Deleted. Undo?')).toBeVisible();

	// Undo brings the entry back with its cost and restores the stat bar.
	await page.getByRole('button', { name: 'Undo' }).click();
	await expect(entriesList(page).getByText('€90.00')).toBeVisible();
	await expect(totalSpendValue(page)).toHaveText('€150.00');

	// Delete it again to reach the final single-entry state; this time leave the Undo window be.
	const sheetForDeleteAgain = await openFirstEntryDetail(page);
	await sheetForDeleteAgain.getByRole('button', { name: /Delete fuel entry/i }).click();

	// The deleted entry is gone; only the €60 entry remains in the list.
	await expect(entriesList(page).getByText('€90.00')).toHaveCount(0);
	await expect(entriesList(page).getByText('€60.00')).toBeVisible();
	// The stat bar reflects only the surviving entry now.
	await expect(totalSpendValue(page)).toHaveText('€60.00');
});
