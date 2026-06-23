import { test, expect, type Page } from '@playwright/test';

// Fresh context per test → empty IndexedDB → first-run state on Home (/).

async function createVehicle(page: Page, name: string): Promise<void> {
	await page.goto('/');
	await page.waitForLoadState('networkidle');

	await expect(page.getByRole('heading', { name: 'No vehicle yet' })).toBeVisible();
	await page.getByRole('button', { name: /Add your vehicle to get started/i }).click();

	await page.getByLabel('Display Name').fill(name);
	await page.getByLabel('Make').fill('Subaru');
	await page.getByLabel('Model').fill('Outback');
	await page.getByRole('button', { name: 'Save vehicle' }).click();

	await expect(page.getByText(/No entries yet for/i)).toBeVisible();
}

test('reminders smoke: add a service reminder and see its due status', async ({ page }) => {
	await createVehicle(page, 'Trail Wagon');

	// Settings is reached from the header (not the bottom nav).
	await page.getByRole('link', { name: 'Settings' }).click();
	await page.waitForLoadState('networkidle');
	await expect(page.getByRole('heading', { name: 'Reminders' })).toBeVisible();

	// With an active vehicle, the reminders section offers an "Add reminder" action.
	await page.getByRole('button', { name: /Add reminder/i }).click();
	await expect(page.getByRole('heading', { name: 'Add reminder' })).toBeVisible();

	// A reminder needs a title and at least one interval (distance and/or time).
	await page.getByLabel('Title').fill('Oil change');
	await page.getByLabel('Every (km)').fill('10000');
	await page.getByLabel('Every (days)').fill('7');

	// A last-service date of "today" makes the 7-day interval compute a concrete due
	// status (due = today + 7 days → within the 14-day "due soon" window). Derived from
	// the browser's real clock so the assertion holds regardless of the run date.
	const todayInputValue = await page.evaluate(() => {
		const now = new Date();
		const month = String(now.getMonth() + 1).padStart(2, '0');
		const day = String(now.getDate()).padStart(2, '0');
		return `${now.getFullYear()}-${month}-${day}`;
	});
	await page.getByLabel(/^Last service date/).fill(todayInputValue);

	await page.getByRole('button', { name: 'Save reminder' }).click();

	// Back in the list, the reminder appears with its title and a due-status badge + label.
	const reminderList = page.getByRole('list', { name: 'Service reminders' });
	await expect(reminderList).toBeVisible();
	const reminderItem = reminderList.getByRole('listitem').filter({ hasText: 'Oil change' });
	await expect(reminderItem).toBeVisible();
	// 7 days out is within the 14-day "due soon" threshold.
	await expect(reminderItem.getByText('Due soon')).toBeVisible();
	await expect(reminderItem.getByText(/Due in .*7 days/)).toBeVisible();
});

test('Up-Next card: an overdue reminder surfaces on Home and "Log this service" prefills Capture', async ({
	page
}) => {
	await createVehicle(page, 'Trail Wagon');

	// Add an overdue reminder via Settings: 7-day interval, last serviced 60 days ago.
	await page.getByRole('link', { name: 'Settings' }).click();
	await page.waitForLoadState('networkidle');
	await page.getByRole('button', { name: /Add reminder/i }).click();

	await page.getByLabel('Title').fill('Oil change');
	await page.getByLabel('Every (days)').fill('7');

	const sixtyDaysAgo = await page.evaluate(() => {
		const d = new Date();
		d.setDate(d.getDate() - 60);
		const month = String(d.getMonth() + 1).padStart(2, '0');
		const day = String(d.getDate()).padStart(2, '0');
		return `${d.getFullYear()}-${month}-${day}`;
	});
	await page.getByLabel(/^Last service date/).fill(sixtyDaysAgo);
	await page.getByRole('button', { name: 'Save reminder' }).click();

	// Confirm it saved as overdue in the Settings list before leaving.
	const settingsList = page.getByRole('list', { name: 'Service reminders' });
	const settingsItem = settingsList.getByRole('listitem').filter({ hasText: 'Oil change' });
	await expect(settingsItem).toBeVisible();
	await expect(settingsItem.getByText('Overdue', { exact: true })).toBeVisible();

	// Story 3.5: the rich Up-Next card now lives in Home's Up-Next slot.
	await page.goto('/');
	await page.waitForLoadState('networkidle');

	const upNext = page.getByRole('region', { name: /up next/i });
	await expect(upNext).toBeVisible();
	await expect(upNext.getByText('Oil change')).toBeVisible();
	await expect(upNext.getByText(/Overdue by 53 days/)).toBeVisible();

	// "Log this service" opens the Capture sheet on the Expense segment with the Type prefilled.
	await upNext.getByRole('button', { name: 'Log this service' }).click();
	await expect(page.getByText('Log an entry')).toBeVisible();
	await expect(page.getByRole('tab', { name: 'Expense', selected: true })).toBeVisible();
	await expect(page.getByLabel(/^Type$/)).toHaveValue('Oil change');

	// Close the sheet, then dismiss the card — it disappears (and Home stays calm).
	await page.getByRole('button', { name: /close/i }).click();
	await page.getByRole('button', { name: 'Dismiss Oil change reminder' }).click();
	await expect(page.getByRole('region', { name: /up next/i })).toHaveCount(0);
});
