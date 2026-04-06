export class PromptAssembler {
  assemble(systemPrompt: string, contextItems: string[], userMessage: string): string {
    const parts: string[] = [];
    if (systemPrompt) parts.push(`[SYSTEM]\n${systemPrompt}`);
    if (contextItems.length > 0) {
      parts.push(`[CONTEXT]\n${contextItems.join("\n")}`);
    }
    parts.push(`[USER]\n${userMessage}`);
    return parts.join("\n\n");
  }
}
