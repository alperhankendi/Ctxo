const DEFAULT_PATTERNS: Array<{ regex: RegExp; label: string }> = [
  // AWS Access Key IDs (AKIA...)
  { regex: /AKIA[0-9A-Z]{16}/g, label: 'AWS_KEY' },
  // AWS Secret Access Keys (40 char base64)
  { regex: /(?<![A-Za-z0-9/+=])[A-Za-z0-9/+=]{40}(?![A-Za-z0-9/+=])/g, label: 'AWS_SECRET' },
  // JWT tokens (eyJ...)
  { regex: /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g, label: 'JWT' },
  // Private IPv4 (10.x.x.x, 172.16-31.x.x, 192.168.x.x)
  { regex: /\b(?:10\.\d{1,3}\.\d{1,3}\.\d{1,3}|172\.(?:1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3})\b/g, label: 'PRIVATE_IP' },
  // Private IPv6 (fc00::/7)
  { regex: /\b[fF][cCdD][0-9a-fA-F]{0,2}(?::[0-9a-fA-F]{1,4}){1,7}\b/g, label: 'PRIVATE_IPV6' },
  // Environment variable assignments for secrets
  { regex: /(?:_SECRET|_KEY|_TOKEN|_PASSWORD)\s*=\s*['"]?[^\s'"]{8,}['"]?/g, label: 'ENV_SECRET' },
  // GCP service account keys
  { regex:/"private_key"\s*:\s*"-----BEGIN[^"]+"/g, label: 'GCP_KEY' },
  // Azure connection strings
  { regex: /AccountKey=[A-Za-z0-9+/=]{20,}/g, label: 'AZURE_KEY' },
];

export class MaskingPipeline {
  private readonly patterns: Array<{ regex: RegExp; label: string }>;

  constructor(additionalPatterns: Array<{ regex: RegExp; label: string }> = []) {
    // Clone RegExp objects to avoid shared mutable lastIndex state
    this.patterns = [...DEFAULT_PATTERNS, ...additionalPatterns].map(({ regex, label }) => ({
      regex: new RegExp(regex.source, regex.flags),
      label,
    }));
  }

  mask(text: string): string {
    if (text.length === 0) return text;

    let result = text;
    for (const { regex, label } of this.patterns) {
      result = result.replace(regex, `[REDACTED:${label}]`);
    }
    return result;
  }
}
