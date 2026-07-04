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
	// Story 9.1: the onboarding wizard replaced the single-form first-run — advance its 3 steps.
	await page.getByRole('button', { name: 'Next' }).click();
	await page.getByRole('button', { name: 'Next' }).click();
	await page.getByRole('button', { name: 'Finish setup' }).click();

	await expect(page.getByText(/No entries yet for/i)).toBeVisible();
}

test('reminders smoke: add a service reminder and see its due status', async ({ page }) => {
	await createVehicle(page, 'Trail Wagon');

	// Story 4.5: reminders now live on the dedicated Maintain surface (bottom nav), not Settings.
	await page
		.getByRole('navigation', { name: 'Main navigation' })
		.getByRole('link', { name: 'Maintain' })
		.click();
	await page.waitForLoadState('networkidle');
	await expect(page).toHaveURL(/\/maintain$/);
	// The dashboard heading (scoped to <main> — the AppHeader also renders an h1 "Maintain").
	await expect(
		page.getByRole('main').getByRole('heading', { name: 'Maintain', level: 1 })
	).toBeVisible();

	// With an active vehicle, Maintain offers an "Add reminder" action.
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

	// Add an overdue reminder via Maintain: 7-day interval, last serviced 60 days ago.
	await page
		.getByRole('navigation', { name: 'Main navigation' })
		.getByRole('link', { name: 'Maintain' })
		.click();
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

	// Confirm it saved as overdue in the Maintain list before leaving.
	const maintainList = page.getByRole('list', { name: 'Service reminders' });
	const maintainItem = maintainList.getByRole('listitem').filter({ hasText: 'Oil change' });
	await expect(maintainItem).toBeVisible();
	await expect(maintainItem.getByText('Overdue', { exact: true })).toBeVisible();

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

	// Close the sheet, then dismiss the card. Story 8.5's due-instance dismissal model
	// (AD-RT-4) makes this a deliberate no-op for an already-OVERDUE reminder: its due
	// instance has, by definition, already passed, so the exact-expiry suppression check
	// is immediately true and the dismissal marker never actually hides it — you cannot
	// dismiss away an overdue fact (honest-signals ethos, mirrors H11a). The card stays.
	await page.getByRole('button', { name: /close/i }).click();
	await page.getByRole('button', { name: 'Dismiss Oil change reminder' }).click();
	await expect(upNext).toBeVisible();
	await expect(upNext.getByText('Oil change')).toBeVisible();
});

test('Reminder loop-close (FR-12): saving a matching expense offers a reset; confirming clears the Up-Next card', async ({
	page
}) => {
	await createVehicle(page, 'Trail Wagon');

	// An overdue, time-based reminder with a 180-day interval (> the 14-day due-soon window) so a
	// reset from "today" recomputes all the way to `ok` (a short interval would land back in due-soon).
	await page
		.getByRole('navigation', { name: 'Main navigation' })
		.getByRole('link', { name: 'Maintain' })
		.click();
	await page.waitForLoadState('networkidle');
	await page.getByRole('button', { name: /Add reminder/i }).click();

	await page.getByLabel('Title').fill('Oil change');
	await page.getByLabel('Every (days)').fill('180');

	const twoHundredDaysAgo = await page.evaluate(() => {
		const d = new Date();
		d.setDate(d.getDate() - 200);
		const month = String(d.getMonth() + 1).padStart(2, '0');
		const day = String(d.getDate()).padStart(2, '0');
		return `${d.getFullYear()}-${month}-${day}`;
	});
	await page.getByLabel(/^Last service date/).fill(twoHundredDaysAgo);
	await page.getByRole('button', { name: 'Save reminder' }).click();

	// Confirm the write committed (it lands in the Maintain list as overdue) before navigating Home,
	// so the Home liveQuery read can't race an in-flight save.
	const maintainItem = page
		.getByRole('list', { name: 'Service reminders' })
		.getByRole('listitem')
		.filter({ hasText: 'Oil change' });
	await expect(maintainItem.getByText('Overdue', { exact: true })).toBeVisible();

	// Home: the overdue reminder is on the Up-Next card.
	await page.goto('/');
	await page.waitForLoadState('networkidle');
	const upNext = page.getByRole('region', { name: /up next/i });
	await expect(upNext.getByText('Oil change')).toBeVisible();

	// "Log this service" → Capture(Expense) with Type prefilled. Add a cost and save.
	await upNext.getByRole('button', { name: 'Log this service' }).click();
	await expect(page.getByRole('tab', { name: 'Expense', selected: true })).toBeVisible();
	await expect(page.getByLabel(/^Type$/)).toHaveValue('Oil change');
	await page.getByLabel(/^Cost$/).fill('78');
	await page.getByRole('button', { name: /^Save$/ }).click();

	// The create-only loop-close offer rides the toast channel (confirm, never auto): a real action
	// button labelled "Reset" appears. Close the sheet (Done), then confirm the reset on the toast.
	await expect(page.getByText('Logged. Reset the Oil change reminder?')).toBeVisible();
	await page.getByRole('button', { name: /^Done$/ }).click();
	await page.getByRole('button', { name: 'Reset' }).click();

	// Confirming wrote the marker → liveQuery recomputes the status to ok → the calm Up-Next card
	// disappears from Home with no further action (AD-4 reactive re-emit).
	await expect(page.getByText('Reset. Next Oil change is set from today.')).toBeVisible();
	await expect(page.getByRole('region', { name: /up next/i })).toHaveCount(0);
});
