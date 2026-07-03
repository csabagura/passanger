import { describe, it, expect } from 'vitest';
import { computeFileIdentity } from '$lib/utils/importFileIdentity';

describe('computeFileIdentity', () => {
	it('is stable for the same name/size/content', () => {
		const a = computeFileIdentity('export.csv', 1234, 'col1,col2\n1,2\n');
		const b = computeFileIdentity('export.csv', 1234, 'col1,col2\n1,2\n');
		expect(a).toBe(b);
	});

	it('differs when the file name differs', () => {
		const a = computeFileIdentity('a.csv', 1234, 'col1,col2\n1,2\n');
		const b = computeFileIdentity('b.csv', 1234, 'col1,col2\n1,2\n');
		expect(a).not.toBe(b);
	});

	it('differs when the file size differs', () => {
		const a = computeFileIdentity('export.csv', 1234, 'col1,col2\n1,2\n');
		const b = computeFileIdentity('export.csv', 5678, 'col1,col2\n1,2\n');
		expect(a).not.toBe(b);
	});

	it('differs when the content differs (same name/size coincidentally)', () => {
		const a = computeFileIdentity('export.csv', 10, 'aaaaaaaaaa');
		const b = computeFileIdentity('export.csv', 10, 'bbbbbbbbbb');
		expect(a).not.toBe(b);
	});
});
