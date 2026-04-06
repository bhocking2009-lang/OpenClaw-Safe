export class Planner {
  plan(goal: string, availableTools: string[]): string[] {
    if (availableTools.length === 0) return [];

    const goalLower = goal.toLowerCase();
    const scored: Array<{ tool: string; score: number }> = availableTools.map((tool) => {
      const toolLower = tool.toLowerCase();
      let score = 0;

      // Simple heuristic: tools whose names appear in the goal get higher priority
      if (goalLower.includes(toolLower)) score += 10;
      if (goalLower.includes("read") && toolLower.includes("read")) score += 5;
      if (goalLower.includes("write") && toolLower.includes("write")) score += 5;
      if (goalLower.includes("search") && toolLower.includes("search")) score += 5;
      if (goalLower.includes("fetch") && toolLower.includes("fetch")) score += 5;
      if (goalLower.includes("memory") && toolLower.includes("memory")) score += 5;

      return { tool, score };
    });

    // Sort by score descending, preserving original order for ties
    scored.sort((a, b) => b.score - a.score);
    return scored.map((s) => s.tool);
  }
}
