import crypto from "crypto";

export type TaskNodeStatus = "pending" | "running" | "done" | "failed";

export interface TaskNode {
  id: string;
  label: string;
  status: TaskNodeStatus;
  dependencies: string[];
  result?: unknown;
}

export class TaskGraph {
  private nodes: Map<string, TaskNode> = new Map();

  addNode(label: string, dependencies: string[] = []): TaskNode {
    const node: TaskNode = {
      id: crypto.randomUUID(),
      label,
      status: "pending",
      dependencies,
    };
    this.nodes.set(node.id, node);
    return node;
  }

  setStatus(id: string, status: TaskNodeStatus, result?: unknown): void {
    const node = this.nodes.get(id);
    if (!node) throw new Error(`Node '${id}' not found.`);
    node.status = status;
    if (result !== undefined) node.result = result;
  }

  get(id: string): TaskNode | undefined {
    return this.nodes.get(id);
  }

  ready(): TaskNode[] {
    return Array.from(this.nodes.values()).filter((node) => {
      if (node.status !== "pending") return false;
      return node.dependencies.every((depId) => {
        const dep = this.nodes.get(depId);
        return dep?.status === "done";
      });
    });
  }

  topologicalOrder(): TaskNode[] {
    const allNodes = Array.from(this.nodes.values());
    const inDegree = new Map<string, number>();
    const adjList = new Map<string, string[]>(); // dep -> dependents

    for (const node of allNodes) {
      if (!inDegree.has(node.id)) inDegree.set(node.id, 0);
      if (!adjList.has(node.id)) adjList.set(node.id, []);
    }

    for (const node of allNodes) {
      for (const depId of node.dependencies) {
        inDegree.set(node.id, (inDegree.get(node.id) ?? 0) + 1);
        if (!adjList.has(depId)) adjList.set(depId, []);
        adjList.get(depId)!.push(node.id);
      }
    }

    const queue: string[] = [];
    for (const [id, deg] of inDegree) {
      if (deg === 0) queue.push(id);
    }

    const result: TaskNode[] = [];
    while (queue.length > 0) {
      const id = queue.shift()!;
      const node = this.nodes.get(id)!;
      result.push(node);
      for (const neighborId of adjList.get(id) ?? []) {
        const newDeg = (inDegree.get(neighborId) ?? 1) - 1;
        inDegree.set(neighborId, newDeg);
        if (newDeg === 0) queue.push(neighborId);
      }
    }

    if (result.length !== allNodes.length) {
      throw new Error("TaskGraph: cycle detected – topological ordering is not possible.");
    }

    return result;
  }
}
