export function memberKey(email: string): string {
  const trimmed = email.trim();
  return trimmed.toLowerCase();
}
