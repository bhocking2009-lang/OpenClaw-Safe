import { TaskGraph, TaskNode, TaskNodeStatus } from "../src/core/task_graph";

describe("TaskGraph", () => {
  let graph: TaskGraph;

  beforeEach(() => {
    graph = new TaskGraph();
  });

  describe("addNode", () => {
    it("adds a node with a label", () => {
      const node = graph.addNode("task-1");
      expect(node.label).toBe("task-1");
      expect(node.status).toBe("pending");
      expect(node.dependencies).toEqual([]);
    });

    it("assigns a unique id", () => {
      const n1 = graph.addNode("a");
      const n2 = graph.addNode("b");
      expect(n1.id).not.toBe(n2.id);
    });

    it("adds a node with dependencies", () => {
      const dep = graph.addNode("dep");
      const node = graph.addNode("dependent", [dep.id]);
      expect(node.dependencies).toContain(dep.id);
    });

    it("node has no result initially", () => {
      const node = graph.addNode("task");
      expect(node.result).toBeUndefined();
    });
  });

  describe("get()", () => {
    it("returns the node by id", () => {
      const node = graph.addNode("test");
      expect(graph.get(node.id)).toBe(node);
    });

    it("returns undefined for unknown id", () => {
      expect(graph.get("nonexistent")).toBeUndefined();
    });
  });

  describe("setStatus()", () => {
    it("sets node status", () => {
      const node = graph.addNode("task");
      graph.setStatus(node.id, "running");
      expect(node.status).toBe("running");
    });

    it("sets node result", () => {
      const node = graph.addNode("task");
      graph.setStatus(node.id, "done", { output: "result" });
      expect(node.result).toEqual({ output: "result" });
    });

    it("throws for unknown node id", () => {
      expect(() => graph.setStatus("nonexistent", "done")).toThrow();
    });

    it("transitions through all statuses", () => {
      const node = graph.addNode("task");
      const statuses: TaskNodeStatus[] = ["running", "done"];
      for (const s of statuses) {
        graph.setStatus(node.id, s);
        expect(node.status).toBe(s);
      }
    });
  });

  describe("ready()", () => {
    it("returns nodes with no dependencies as ready", () => {
      const n = graph.addNode("no-deps");
      const ready = graph.ready();
      expect(ready).toContain(n);
    });

    it("does not return done nodes", () => {
      const n = graph.addNode("task");
      graph.setStatus(n.id, "done");
      expect(graph.ready()).not.toContain(n);
    });

    it("does not return running nodes", () => {
      const n = graph.addNode("task");
      graph.setStatus(n.id, "running");
      expect(graph.ready()).not.toContain(n);
    });

    it("does not return failed nodes", () => {
      const n = graph.addNode("task");
      graph.setStatus(n.id, "failed");
      expect(graph.ready()).not.toContain(n);
    });

    it("returns node once all deps are done", () => {
      const dep = graph.addNode("dep");
      const task = graph.addNode("task", [dep.id]);
      expect(graph.ready()).not.toContain(task);
      graph.setStatus(dep.id, "done");
      expect(graph.ready()).toContain(task);
    });

    it("does not return node if only some deps are done", () => {
      const dep1 = graph.addNode("dep1");
      const dep2 = graph.addNode("dep2");
      const task = graph.addNode("task", [dep1.id, dep2.id]);
      graph.setStatus(dep1.id, "done");
      expect(graph.ready()).not.toContain(task);
      graph.setStatus(dep2.id, "done");
      expect(graph.ready()).toContain(task);
    });

    it("returns multiple ready nodes at once", () => {
      const n1 = graph.addNode("t1");
      const n2 = graph.addNode("t2");
      const ready = graph.ready();
      expect(ready).toContain(n1);
      expect(ready).toContain(n2);
    });
  });

  describe("topologicalOrder()", () => {
    it("returns single node", () => {
      const n = graph.addNode("only");
      const order = graph.topologicalOrder();
      expect(order).toHaveLength(1);
      expect(order[0]).toBe(n);
    });

    it("returns nodes with no deps before their dependents", () => {
      const a = graph.addNode("a");
      const b = graph.addNode("b", [a.id]);
      const order = graph.topologicalOrder();
      expect(order.indexOf(a)).toBeLessThan(order.indexOf(b));
    });

    it("handles a chain a -> b -> c", () => {
      const a = graph.addNode("a");
      const b = graph.addNode("b", [a.id]);
      const c = graph.addNode("c", [b.id]);
      const order = graph.topologicalOrder();
      expect(order.indexOf(a)).toBeLessThan(order.indexOf(b));
      expect(order.indexOf(b)).toBeLessThan(order.indexOf(c));
    });

    it("handles a diamond: a -> b, a -> c, b -> d, c -> d", () => {
      const a = graph.addNode("a");
      const b = graph.addNode("b", [a.id]);
      const c = graph.addNode("c", [a.id]);
      const d = graph.addNode("d", [b.id, c.id]);
      const order = graph.topologicalOrder();
      expect(order.indexOf(a)).toBeLessThan(order.indexOf(b));
      expect(order.indexOf(a)).toBeLessThan(order.indexOf(c));
      expect(order.indexOf(b)).toBeLessThan(order.indexOf(d));
      expect(order.indexOf(c)).toBeLessThan(order.indexOf(d));
    });

    it("returns all nodes", () => {
      graph.addNode("x");
      graph.addNode("y");
      graph.addNode("z");
      expect(graph.topologicalOrder()).toHaveLength(3);
    });

    it("returns empty array for empty graph", () => {
      expect(graph.topologicalOrder()).toHaveLength(0);
    });
  });
});
