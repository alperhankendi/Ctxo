import { describe, it, expect, vi } from 'vitest';
import { MaskingPipeline } from '../masking-pipeline.js';

describe('MaskingPipeline', () => {
  const pipeline = new MaskingPipeline();

  it('redacts AWS access key pattern (AKIA...)', () => {
    const text = 'aws_key = AKIAIOSFODNN7EXAMPLE';
    const result = pipeline.mask(text);
    expect(result).toContain('[REDACTED:AWS_KEY]');
    expect(result).not.toContain('AKIAIOSFODNN7EXAMPLE');
  });

  it('redacts JWT token pattern (eyJ...)', () => {
    const jwt = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U';
    const result = pipeline.mask(`token: ${jwt}`);
    expect(result).toContain('[REDACTED:JWT]');
    expect(result).not.toContain('eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9');
  });

  it('redacts private IPv4 address (192.168.x.x)', () => {
    const result = pipeline.mask('server at 192.168.1.100');
    expect(result).toContain('[REDACTED:PRIVATE_IP]');
    expect(result).not.toContain('192.168.1.100');
  });

  it('redacts private IPv4 address (10.x.x.x)', () => {
    const result = pipeline.mask('host: 10.0.0.1');
    expect(result).toContain('[REDACTED:PRIVATE_IP]');
  });

  it('redacts private IPv4 address (172.16.x.x)', () => {
    const result = pipeline.mask('host: 172.16.0.1');
    expect(result).toContain('[REDACTED:PRIVATE_IP]');
  });

  it('redacts env variable values for secrets', () => {
    const result = pipeline.mask('DATABASE_PASSWORD=SuperSecret123!');
    expect(result).toContain('[REDACTED:ENV_SECRET]');
    expect(result).not.toContain('SuperSecret123!');
  });

  it('redacts _SECRET env pattern', () => {
    const result = pipeline.mask('API_SECRET=mySecretValue1234');
    expect(result).toContain('[REDACTED:ENV_SECRET]');
  });

  it('redacts _TOKEN env pattern', () => {
    const result = pipeline.mask('AUTH_TOKEN=abc123def456ghi789');
    expect(result).toContain('[REDACTED:ENV_SECRET]');
  });

  it('does not redact normal code identifiers (no false positives)', () => {
    const code = 'function processPayment(amount: number): boolean { return amount > 0; }';
    const result = pipeline.mask(code);
    expect(result).toBe(code);
  });

  it('redacts multiple sensitive patterns in single string', () => {
    const text = 'key=AKIAIOSFODNN7EXAMPLE host=192.168.1.1';
    const result = pipeline.mask(text);
    expect(result).toContain('[REDACTED:AWS_KEY]');
    expect(result).toContain('[REDACTED:PRIVATE_IP]');
  });

  it('returns empty string unchanged', () => {
    expect(pipeline.mask('')).toBe('');
  });

  it('returns non-matching string unchanged', () => {
    const text = 'Hello world, this is normal text';
    expect(pipeline.mask(text)).toBe(text);
  });

  it('applies custom patterns injected via constructor', () => {
    const customPipeline = new MaskingPipeline([
      { regex: /CUSTOM-[A-Z]{10}/g, label: 'CUSTOM' },
    ]);
    const result = customPipeline.mask('secret: CUSTOM-ABCDEFGHIJ');
    expect(result).toContain('[REDACTED:CUSTOM]');
  });

  it('handles string with unicode characters', () => {
    const text = '认证密码=192.168.1.1';
    const result = pipeline.mask(text);
    expect(result).toContain('[REDACTED:PRIVATE_IP]');
    expect(result).toContain('认证密码=');
  });

  it('redacts Azure connection string keys', () => {
    const result = pipeline.mask('AccountKey=dGhpcyBpcyBhIHRlc3Qga2V5IHZhbHVl');
    expect(result).toContain('[REDACTED:AZURE_KEY]');
  });

  it('handles repeated calls without state leaking between invocations', () => {
    const first = pipeline.mask('host: 192.168.1.1');
    const second = pipeline.mask('host: 10.0.0.1');
    expect(first).toContain('[REDACTED:PRIVATE_IP]');
    expect(second).toContain('[REDACTED:PRIVATE_IP]');
  });
});

describe('MaskingPipeline.fromConfig', () => {
  it('creates pipeline with valid config patterns', () => {
    const pipeline = MaskingPipeline.fromConfig([
      { pattern: 'SECRET-[A-Z]+', label: 'CUSTOM_SECRET' },
    ]);
    const result = pipeline.mask('key: SECRET-ABCDEF');
    expect(result).toContain('[REDACTED:CUSTOM_SECRET]');
  });

  it('creates pipeline with custom flags', () => {
    const pipeline = MaskingPipeline.fromConfig([
      { pattern: 'token_[a-z]+', flags: 'gi', label: 'TOKEN' },
    ]);
    const result = pipeline.mask('TOKEN_ABC');
    expect(result).toContain('[REDACTED:TOKEN]');
  });

  it('skips invalid regex patterns and logs error', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const pipeline = MaskingPipeline.fromConfig([
      { pattern: '[invalid', label: 'BAD' },
      { pattern: 'valid-[0-9]+', label: 'GOOD' },
    ]);

    expect(spy).toHaveBeenCalledWith(expect.stringContaining('Invalid regex'));
    spy.mockRestore();

    // Valid pattern should still work
    const result = pipeline.mask('id: valid-123');
    expect(result).toContain('[REDACTED:GOOD]');
  });

  it('returns pipeline with only default patterns when all configs are invalid', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const pipeline = MaskingPipeline.fromConfig([
      { pattern: '[bad1', label: 'X' },
      { pattern: '(bad2', label: 'Y' },
    ]);
    spy.mockRestore();

    // Default patterns still work
    const result = pipeline.mask('AKIAIOSFODNN7EXAMPLE');
    expect(result).toContain('[REDACTED:AWS_KEY]');
  });

  it('defaults flags to "g" when not specified', () => {
    const pipeline = MaskingPipeline.fromConfig([
      { pattern: 'test', label: 'TEST' },
    ]);
    const result = pipeline.mask('test test test');
    // Should replace all occurrences (global flag)
    expect(result).toBe('[REDACTED:TEST] [REDACTED:TEST] [REDACTED:TEST]');
  });
});
