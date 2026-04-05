import crypto from "crypto";

export interface MemoryItem {
  id: string;
  key: string;
  value: unknown;
  createdAt: Date;
}

export function createMemoryItem(key: string, value: unknown): MemoryItem {
  return { id: crypto.randomUUID(), key, value, createdAt: new Date() };
}
