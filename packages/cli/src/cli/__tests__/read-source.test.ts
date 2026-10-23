import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readSourceText } from '../read-source.js';
import { ContentHasher } from '../../core/staleness/content-hasher.js';

// Synthetic library-lending script; the accented and astral characters cover multi-byte decoding.
const SCRIPT = [
  'CREATE TABLE dbo.Loans (',
  '  LoanId int NOT NULL,',
  "  Note nvarchar(50) NULL -- 'dönüş tarihi' \u{1F4DA}",
  ');',
  '',
].join('\r\n');

function utf16le(text: string, bom: boolean): Buffer {
  const body = Buffer.from(text, 'utf16le');
  return bom ? Buffer.concat([Buffer.from([0xff, 0xfe]), body]) : body;
}

function utf16be(text: string, bom: boolean): Buffer {
  const body = Buffer.from(text, 'utf16le').swap16();
  return bom ? Buffer.concat([Buffer.from([0xfe, 0xff]), body]) : body;
}

describe('readSourceText', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'ctxo-read-source-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  });

  function write(name: string, bytes: Buffer | string): string {
    const path = join(dir, name);
    writeFileSync(path, bytes);
    return path;
  }

  it('decodes UTF-16 LE with a BOM', () => {
    const path = write('loans-le.sql', utf16le(SCRIPT, true));
    const text = readSourceText(path);
    expect(text).toBe(SCRIPT);
    expect(text.charCodeAt(0)).not.toBe(0xfeff);
    // Same text, same hash as the plain UTF-8 file: that is what keeps `ctxo index --check` fresh.
    const utf8Path = write('loans-utf8.sql', SCRIPT);
    const hasher = new ContentHasher();
    expect(hasher.hash(text)).toBe(hasher.hash(readSourceText(utf8Path)));
  });

  it('decodes UTF-16 BE with a BOM', () => {
    const path = write('loans-be.sql', utf16be(SCRIPT, true));
    const text = readSourceText(path);
    expect(text).toBe(SCRIPT);
    expect(text.charCodeAt(0)).not.toBe(0xfeff);
  });

  it('ignores a trailing odd byte in UTF-16 content', () => {
    const le = Buffer.concat([utf16le('select 1;', true), Buffer.from([0x41])]);
    expect(readSourceText(write('odd-le.sql', le))).toBe('select 1;');
    const be = Buffer.concat([utf16be('select 1;', true), Buffer.from([0x41])]);
    expect(readSourceText(write('odd-be.sql', be))).toBe('select 1;');
  });

  it('decodes a UTF-16 file that holds only a BOM as empty text', () => {
    expect(readSourceText(write('empty-le.sql', Buffer.from([0xff, 0xfe])))).toBe('');
    expect(readSourceText(write('empty-be.sql', Buffer.from([0xfe, 0xff])))).toBe('');
  });

  it('keeps UTF-8 decoding unchanged, including a UTF-8 BOM character', () => {
    const plain = write('plain.sql', SCRIPT);
    expect(readSourceText(plain)).toBe(readFileSync(plain, 'utf-8'));
    expect(readSourceText(plain)).toBe(SCRIPT);

    const withBom = write('bom.sql', Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(SCRIPT, 'utf-8')]));
    const text = readSourceText(withBom);
    expect(text).toBe(readFileSync(withBom, 'utf-8'));
    // The BOM stays in the text, so a hash computed before this change stays valid.
    expect(text.charCodeAt(0)).toBe(0xfeff);
    expect(text.slice(1)).toBe(SCRIPT);

    // UTF-16 without a BOM is not guessed at: it decodes exactly as the old reader did.
    const noBom = write('nobom.sql', utf16le('select 1;', false));
    expect(readSourceText(noBom)).toBe(readFileSync(noBom, 'utf-8'));
  });

  it('throws like readFileSync when the file does not exist', () => {
    expect(() => readSourceText(join(dir, 'missing.sql'))).toThrow(/ENOENT/);
  });
});
