import { randomUUID } from 'node:crypto';

/** Unique id for cards, conversation turns and history entries. */
export function newId(): string {
  return randomUUID();
}
