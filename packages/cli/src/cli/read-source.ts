import { readFileSync } from 'node:fs';

/**
 * Reads a source file the way indexing, `--check` and watch must all read it: one decoder, so the text
 * that is parsed and the text that is hashed never differ between those paths.
 *
 * A UTF-16 file with a BOM (`FF FE` little endian, `FE FF` big endian) is decoded and its BOM dropped.
 * SSMS saves SQL scripts that way, and read as UTF-8 they would be unreadable to the plugin. Every other
 * file is read exactly as `readFileSync(path, 'utf-8')` does, so a UTF-8 BOM stays in the text and the
 * content hash of a file indexed earlier does not change.
 *
 * UTF-16 without a BOM is not detected: guessing would misread UTF-8 files.
 */
export function readSourceText(absolutePath: string): string {
  const bytes = readFileSync(absolutePath);
  if (bytes.length >= 2) {
    const first = bytes[0];
    const second = bytes[1];
    if (first === 0xff && second === 0xfe) return decodeUtf16(bytes, false);
    if (first === 0xfe && second === 0xff) return decodeUtf16(bytes, true);
  }
  return bytes.toString('utf-8');
}

const UTF16_BOM_LENGTH = 2;

/** Decodes the code units after a 2-byte BOM. A trailing odd byte cannot form a code unit and is ignored. */
function decodeUtf16(bytes: Buffer, bigEndian: boolean): string {
  const textLength = bytes.length - UTF16_BOM_LENGTH;
  const wholeUnitsLength = textLength - (textLength % 2);
  // Copy: swap16 works in place and `subarray` would reach back into `bytes`.
  const units = Buffer.from(bytes.subarray(UTF16_BOM_LENGTH, UTF16_BOM_LENGTH + wholeUnitsLength));
  return (bigEndian ? units.swap16() : units).toString('utf16le');
}
