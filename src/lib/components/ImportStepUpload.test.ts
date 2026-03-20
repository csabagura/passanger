import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/svelte';

// Mock papaparse dynamic import
vi.mock('papaparse', () => ({
	parse: vi.fn((content: string) => {
		const lines = content.split('\n').filter((line: string) => line.trim() !== '');
		return {
			data: lines.map((line: string) => line.split(',')),
			errors: []
		};
	})
}));

// Mock importDetect
vi.mock('$lib/utils/importDetect', () => ({
	detectCSVFormat: vi.fn((content: string) => {
		const firstLine = content.split('\n')[0]?.trim() ?? '';
		if (firstLine.startsWith('## Vehicle')) return { data: 'acar', error: null };
		if (firstLine.includes('fuelup_date')) return { data: 'fuelly', error: null };
		return { data: 'generic', error: null };
	})
}));

import ImportStepUpload from './ImportStepUpload.svelte';

function createFile(content: string, name = 'test.csv', type = 'text/csv'): File {
	return new File([content], name, { type });
}

async function uploadFile(file: File) {
	const input = document.querySelector('input[type="file"]') as HTMLInputElement;
	expect(input).not.toBeNull();
	await fireEvent.change(input, { target: { files: [file] } });
}

describe('ImportStepUpload', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	afterEach(() => {
		cleanup();
	});

	it('renders file input area with Choose File label', () => {
		const onFileProcessed = vi.fn();
		render(ImportStepUpload, { props: { selectedSource: 'fuelly', onFileProcessed } });

		expect(screen.getByText('Choose File')).toBeTruthy();
	});

	it('accepts only .csv and .txt files', () => {
		const onFileProcessed = vi.fn();
		render(ImportStepUpload, { props: { selectedSource: 'fuelly', onFileProcessed } });

		const input = document.querySelector('input[type="file"]') as HTMLInputElement;
		expect(input.getAttribute('accept')).toBe('.csv,.txt');
	});

	it('rejects empty files (0 bytes)', async () => {
		const onFileProcessed = vi.fn();
		render(ImportStepUpload, { props: { selectedSource: 'fuelly', onFileProcessed } });

		const emptyFile = new File([], 'empty.csv', { type: 'text/csv' });
		await uploadFile(emptyFile);

		await waitFor(() => {
			expect(screen.getByRole('alert')).toBeTruthy();
			expect(screen.getByText(/empty/i)).toBeTruthy();
		});
	});

	it('rejects files >= 10MB', async () => {
		const onFileProcessed = vi.fn();
		render(ImportStepUpload, { props: { selectedSource: 'fuelly', onFileProcessed } });

		// Create a file object and override size
		const largeFile = new File(['x'], 'large.csv', { type: 'text/csv' });
		Object.defineProperty(largeFile, 'size', { value: 10 * 1024 * 1024 });
		await uploadFile(largeFile);

		await waitFor(() => {
			expect(screen.getByRole('alert')).toBeTruthy();
			expect(screen.getByText(/too large/i)).toBeTruthy();
		});
	});

	it('shows warning for files > 5MB', async () => {
		const onFileProcessed = vi.fn();
		render(ImportStepUpload, { props: { selectedSource: 'fuelly', onFileProcessed } });

		const csv = 'fuelup_date,gallons\n2024-01-01,10\n2024-01-02,12';
		const mediumFile = new File([csv], 'medium.csv', { type: 'text/csv' });
		Object.defineProperty(mediumFile, 'size', { value: 6 * 1024 * 1024 });
		await uploadFile(mediumFile);

		await waitFor(() => {
			expect(screen.getByText(/large file/i)).toBeTruthy();
		});
	});

	it('shows file name and row count after successful upload', async () => {
		const onFileProcessed = vi.fn();
		render(ImportStepUpload, { props: { selectedSource: 'fuelly', onFileProcessed } });

		const csv = 'fuelup_date,gallons\n2024-01-01,10\n2024-01-02,12';
		const file = createFile(csv, 'mydata.csv');
		await uploadFile(file);

		await waitFor(() => {
			expect(screen.getByText('mydata.csv')).toBeTruthy();
			expect(screen.getByText(/found 2 rows/i)).toBeTruthy();
		});
	});

	it('shows detected format badge after upload', async () => {
		const onFileProcessed = vi.fn();
		render(ImportStepUpload, { props: { selectedSource: 'fuelly', onFileProcessed } });

		const csv = 'fuelup_date,gallons\n2024-01-01,10\n2024-01-02,12';
		const file = createFile(csv);
		await uploadFile(file);

		await waitFor(() => {
			expect(screen.getByText(/detected: fuelly/i)).toBeTruthy();
		});
	});

	it('shows conflict resolution when detected format disagrees with selection', async () => {
		const onFileProcessed = vi.fn();
		render(ImportStepUpload, { props: { selectedSource: 'drivvo', onFileProcessed } });

		const csv = '## Vehicle: Honda\nDate,Odometer\n2024-01-01,10000';
		const file = createFile(csv);
		await uploadFile(file);

		await waitFor(() => {
			expect(screen.getByText(/we detected/i)).toBeTruthy();
		});
	});

	it('resolves conflict when user picks detected format', async () => {
		const onFileProcessed = vi.fn();
		render(ImportStepUpload, { props: { selectedSource: 'drivvo', onFileProcessed } });

		const csv = '## Vehicle: Honda\nDate,Odometer\n2024-01-01,10000';
		const file = createFile(csv);
		await uploadFile(file);

		await waitFor(() => {
			expect(screen.getByText(/we detected/i)).toBeTruthy();
		});

		// Resolve conflict
		const useAcarBtn = screen.getAllByRole('button').find((b) => b.textContent?.includes('aCar'));
		expect(useAcarBtn).toBeTruthy();
		await fireEvent.click(useAcarBtn!);

		// Continue button should now be enabled
		await waitFor(() => {
			const continueBtn = screen.getByRole('button', { name: /continue/i });
			expect(continueBtn.hasAttribute('disabled')).toBe(false);
		});
	});

	it('disables Continue button while conflict is unresolved', async () => {
		const onFileProcessed = vi.fn();
		render(ImportStepUpload, { props: { selectedSource: 'drivvo', onFileProcessed } });

		const csv = '## Vehicle: Honda\nDate,Odometer\n2024-01-01,10000';
		const file = createFile(csv);
		await uploadFile(file);

		await waitFor(() => {
			const continueBtn = screen.getByRole('button', { name: /continue/i });
			expect(continueBtn.hasAttribute('disabled')).toBe(true);
		});
	});

	it('rejects files exceeding MAX_CSV_ROWS (>10,000 rows)', async () => {
		const onFileProcessed = vi.fn();
		render(ImportStepUpload, { props: { selectedSource: 'fuelly', onFileProcessed } });

		// Create CSV with header + 10,001 data rows = 10,002 lines total
		const header = 'fuelup_date,gallons';
		const rows = Array.from({ length: 10_001 }, (_, i) => `2024-01-01,${i}`);
		const csv = [header, ...rows].join('\n');
		const file = createFile(csv, 'huge.csv');
		await uploadFile(file);

		await waitFor(() => {
			expect(screen.getByRole('alert')).toBeTruthy();
			expect(screen.getByText(/more than 10,000 rows/i)).toBeTruthy();
		});
	});

	it('rejects header-only file (0 rows after parse)', async () => {
		const onFileProcessed = vi.fn();
		render(ImportStepUpload, { props: { selectedSource: 'fuelly', onFileProcessed } });

		const csv = 'fuelup_date,gallons';
		const file = createFile(csv, 'headeronly.csv');
		await uploadFile(file);

		await waitFor(() => {
			expect(screen.getByRole('alert')).toBeTruthy();
			expect(screen.getByText(/empty/i)).toBeTruthy();
		});
	});

	it('calls onFileProcessed when Continue is clicked', async () => {
		const onFileProcessed = vi.fn();
		render(ImportStepUpload, { props: { selectedSource: 'fuelly', onFileProcessed } });

		const csv = 'fuelup_date,gallons\n2024-01-01,10\n2024-01-02,12';
		const file = createFile(csv, 'export.csv');
		await uploadFile(file);

		await waitFor(() => {
			const continueBtn = screen.getByRole('button', { name: /continue/i });
			expect(continueBtn.hasAttribute('disabled')).toBe(false);
		});

		await fireEvent.click(screen.getByRole('button', { name: /continue/i }));

		expect(onFileProcessed).toHaveBeenCalledTimes(1);
		expect(onFileProcessed).toHaveBeenCalledWith(
			expect.objectContaining({
				file: expect.any(File),
				rawCSV: csv,
				confirmedFormat: 'fuelly',
				rowCount: 2
			})
		);
	});

	it('uses selectedSource (not generic) as confirmedFormat when detection is unknown', async () => {
		const onFileProcessed = vi.fn();
		render(ImportStepUpload, { props: { selectedSource: 'drivvo', onFileProcessed } });

		// This content will be detected as 'generic' by the mock
		const csv = 'date,amount\n2024-01-01,50\n2024-01-02,60';
		const file = createFile(csv, 'unknown.csv');
		await uploadFile(file);

		await waitFor(() => {
			const continueBtn = screen.getByRole('button', { name: /continue/i });
			expect(continueBtn.hasAttribute('disabled')).toBe(false);
		});

		await fireEvent.click(screen.getByRole('button', { name: /continue/i }));

		expect(onFileProcessed).toHaveBeenCalledWith(
			expect.objectContaining({
				confirmedFormat: 'drivvo' // Should use selectedSource, NOT 'generic'
			})
		);
	});
});
