// File-identity fingerprinting for the import wizard — Story 8.3 AC5 (S5) + AC10 (B4/S32).
// A lightweight, dependency-free identity value (name + size + a cheap content hash) computed
// once per upload. Used to (a) invalidate the Review-correction cache when a second, different
// file is processed without an explicit "start new import" (AC5), and (b) detect "this is the
// same file being re-opened" on resume, alongside the resumable-import payload (AC10). No crypto
// or hashing npm dependency is added — a small pure-JS string hash is sufficient here; this is an
// identity check, not a security boundary.

/**
 * A simple, fast, non-cryptographic 32-bit hash (FNV-1a) over the given string, returned as an
 * unsigned hex string. Hashes the FULL content — a code-review patch (Story 8.3 review) replaced
 * an earlier first-8KB-only sample, which let two different files sharing a name, size, and
 * identical first 8KB (e.g. a shared header/boilerplate prefix) collide as "the same file" and
 * silently inherit each other's Review-correction cache. `MAX_CSV_ROWS`/the import size caps keep
 * this bounded (a few MB at most), so hashing in full is cheap enough to not need sampling.
 */
function cheapContentHash(content: string): string {
	let hash = 0x811c9dc5;
	for (let i = 0; i < content.length; i++) {
		hash ^= content.charCodeAt(i);
		hash = Math.imul(hash, 0x01000193);
	}
	return (hash >>> 0).toString(16);
}

/**
 * Compute a file-identity fingerprint from its name, byte size, and a cheap hash of its content.
 * Two uploads with the same fingerprint are treated as "the same file"; any difference (a
 * different file, or an edited/re-exported version of the same-named file) is treated as a new
 * upload.
 */
export function computeFileIdentity(fileName: string, fileSize: number, rawCSV: string): string {
	return `${fileName}|${fileSize}|${cheapContentHash(rawCSV)}`;
}
