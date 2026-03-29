import { createHash } from 'node:crypto';

export class ContentHasher {
  hash(content: string): string {
    return createHash('sha256').update(content, 'utf-8').digest('hex');
  }
}
