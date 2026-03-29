import { describe, it, expect } from 'vitest';
import { MaskingPipeline } from '../masking-pipeline.js';

describe('MaskingPipeline — git hash false positives (#3)', () => {
  const pipeline = new MaskingPipeline();

  it('does NOT mask lowercase git SHA-1 hash', () => {
    const hash = 'e443174abcdef1234567890abcdef1234567890a';
    expect(pipeline.mask(hash)).toBe(hash);
  });

  it('does NOT mask uppercase git SHA-1 hash', () => {
    const hash = 'E443174ABCDEF1234567890ABCDEF1234567890A';
    expect(pipeline.mask(hash)).toBe(hash);
  });

  it('does NOT mask mixed-case hex-only hash', () => {
    const hash = 'AbCdEf1234567890AbCdEf1234567890AbCdEf12';
    expect(pipeline.mask(hash)).toBe(hash);
  });

  it('does NOT mask git hash in commit context', () => {
    const text = 'commit abc123def456789012345678901234567890ab author: dev';
    expect(pipeline.mask(text)).toBe(text);
  });
});

describe('MaskingPipeline — AWS secret after = character (#2)', () => {
  const pipeline = new MaskingPipeline();

  it('redacts AWS secret after = in env assignment', () => {
    const text = 'AWS_SECRET_ACCESS_KEY=wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY';
    const result = pipeline.mask(text);
    expect(result).toContain('[REDACTED:');
    expect(result).not.toContain('wJalrXUtnFEMI');
  });

  it('redacts AWS secret after = with quotes', () => {
    const text = 'secret="wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY"';
    const result = pipeline.mask(text);
    expect(result).toContain('[REDACTED:');
  });

  it('redacts AWS secret after : in JSON', () => {
    const text = '"secretKey": "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY"';
    const result = pipeline.mask(text);
    expect(result).toContain('[REDACTED:');
  });

  it('still redacts standalone AWS secret', () => {
    const text = 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY';
    const result = pipeline.mask(text);
    expect(result).toContain('[REDACTED:AWS_SECRET]');
  });
});

describe('MaskingPipeline — index persistence (#5)', () => {
  const pipeline = new MaskingPipeline();

  it('masks credentials embedded in JSON index format', () => {
    const indexJson = JSON.stringify({
      file: 'src/config.ts',
      symbols: [{ symbolId: 'src/config.ts::AKIAIOSFODNN7EXAMPLE::variable', name: 'AKIAIOSFODNN7EXAMPLE' }],
    });
    const result = pipeline.mask(indexJson);
    expect(result).not.toContain('AKIAIOSFODNN7EXAMPLE');
    expect(result).toContain('[REDACTED:AWS_KEY]');
  });

  it('masks private IPs in plain text within index JSON', () => {
    const indexJson = JSON.stringify({
      symbols: [{ name: 'server at 192.168.1.100 port 8080' }],
    });
    const result = pipeline.mask(indexJson);
    expect(result).not.toContain('192.168.1.100');
  });
});
