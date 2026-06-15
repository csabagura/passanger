import { test, expect, type Page } from '@playwright/test';

// Fresh context per test → empty IndexedDB → first-run state on /log.

async function createVehicle(page: Page, name: string): Promise<void> {
	await page.goto('/log');
	await page.waitForLoadState('networkidle');

	await expect(page.getByRole('heading', { name: 'No vehicle yet' })).toBeVisible();
	await page.getByRole('button', { name: /Add your vehicle to get started/i }).click();

	await page.getByLabel('Display Name').fill(name);
	await page.getByLabel('Make').fill('Subaru');
	await page.getByLabel('Model').fill('Outback');
	await page.getByRole('button', { name: 'Save vehicle' }).click();

	await expect(page.getByRole('radiogroup', { name: 'Log mode' })).toBeVisible();
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
