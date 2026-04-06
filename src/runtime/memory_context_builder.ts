import { MemoryItem } from "../models/memory_item";

export class MemoryContextBuilder {
  build(items: MemoryItem[]): string {
    if (items.length === 0) return "";
    const lines = items.map((item) => {
      const value =
        typeof item.value === "object" ? JSON.stringify(item.value) : String(item.value);
      return `${item.key}: ${value}`;
    });
    return lines.join("\n");
  }
}
