// File-identity fingerprinting for the import wizard — Story 8.3 AC5 (S5) + AC10 (B4/S32).
// A lightweight, dependency-free identity value (name + size + a cheap content hash) computed
// once per upload. Used to (a) invalidate the Review-correction cache when a second, different
// file is processed without an explicit "start new import" (AC5), and (b) detect "this is the
// same file being re-opened" on resume, alongside the resumable-import payload (AC10). No crypto
// or hashing npm dependency is added — a small pure-JS string hash is sufficient here; this is an
// identity check, not a security boundary.

/**
 * A simple, fast, non-cryptographic 32-bit hash (FNV-1a) over the given string, returned as an
 * unsigned hex string. Only the first `sampleLength` characters are hashed — enough to
 * distinguish real-world exports cheaply without hashing multi-MB files in full.
 */
function cheapContentHash(content: string, sampleLength = 8192): string {
	const sample = content.slice(0, sampleLength);
	let hash = 0x811c9dc5;
	for (let i = 0; i < sample.length; i++) {
		hash ^= sample.charCodeAt(i);
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
