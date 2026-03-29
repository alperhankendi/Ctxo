// Intentionally planted credentials for zero-leakage testing
export const AWS_KEY = 'AKIAIOSFODNN7EXAMPLE';
export const AWS_SECRET = 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY';
export const JWT_TOKEN = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U';
export const DB_PASSWORD = 'DATABASE_PASSWORD=SuperSecret123!';
export const PRIVATE_IP = '192.168.1.100';
export const AZURE_KEY = 'AccountKey=dGhpcyBpcyBhIHRlc3Qga2V5IHZhbHVl';
export const API_TOKEN = 'AUTH_TOKEN=abc123def456ghi789jkl012';

export function getConfig() {
  return {
    awsKey: AWS_KEY,
    privateServer: PRIVATE_IP,
  };
}
