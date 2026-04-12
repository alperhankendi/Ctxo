import { formatName } from './utils';

export function greet(name: string): string {
  return `Hello, ${formatName(name)}!`;
}
