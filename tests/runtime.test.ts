import { PromptAssembler } from "../src/runtime/prompt_assembler";
import { ModelLoop, ModelLoopOptions } from "../src/runtime/model_loop";
import { Planner } from "../src/runtime/planner";
import { MemoryContextBuilder } from "../src/runtime/memory_context_builder";
import { createMemoryItem } from "../src/models/memory_item";

describe("PromptAssembler", () => {
  let assembler: PromptAssembler;

  beforeEach(() => {
    assembler = new PromptAssembler();
  });

  it("assembles system + user message", () => {
    const result = assembler.assemble("You are a helpful assistant.", [], "What is 2+2?");
    expect(result).toContain("You are a helpful assistant.");
    expect(result).toContain("What is 2+2?");
  });

  it("includes context items", () => {
    const result = assembler.assemble("System.", ["ctx1", "ctx2"], "User message");
    expect(result).toContain("ctx1");
    expect(result).toContain("ctx2");
  });

  it("includes SYSTEM section label", () => {
    const result = assembler.assemble("sys", [], "user");
    expect(result).toContain("[SYSTEM]");
  });

  it("includes USER section label", () => {
    const result = assembler.assemble("sys", [], "user msg");
    expect(result).toContain("[USER]");
  });

  it("includes CONTEXT section when context items present", () => {
    const result = assembler.assemble("sys", ["item"], "user");
    expect(result).toContain("[CONTEXT]");
  });

  it("omits CONTEXT section when no context items", () => {
    const result = assembler.assemble("sys", [], "user");
    expect(result).not.toContain("[CONTEXT]");
  });

  it("handles empty system prompt", () => {
    const result = assembler.assemble("", ["ctx"], "user msg");
    expect(result).toContain("ctx");
    expect(result).toContain("user msg");
  });

  it("assembles multiple context items", () => {
    const items = ["item1", "item2", "item3"];
    const result = assembler.assemble("sys", items, "user");
    for (const item of items) {
      expect(result).toContain(item);
    }
  });

  it("returns a string", () => {
    expect(typeof assembler.assemble("s", [], "u")).toBe("string");
  });
});

describe("ModelLoop", () => {
  it("runs steps and returns ModelStep array", () => {
    const loop = new ModelLoop({ maxSteps: 5, stopOnError: true });
    const steps = [
      { input: "input1", output: "output1" },
      { input: "input2", output: "output2" },
    ];
    const result = loop.run("prompt", steps);
    expect(result).toHaveLength(2);
    expect(result[0].input).toBe("input1");
    expect(result[0].output).toBe("output1");
    expect(result[1].stepIndex).toBe(1);
  });

  it("respects maxSteps limit", () => {
    const loop = new ModelLoop({ maxSteps: 2, stopOnError: true });
    const steps = Array.from({ length: 5 }, (_, i) => ({ input: `i${i}`, output: `o${i}` }));
    const result = loop.run("prompt", steps);
    expect(result).toHaveLength(2);
  });

  it("returns empty array for empty steps", () => {
    const loop = new ModelLoop({ maxSteps: 10, stopOnError: true });
    expect(loop.run("prompt", [])).toHaveLength(0);
  });

  it("assigns stepIndex correctly", () => {
    const loop = new ModelLoop({ maxSteps: 3, stopOnError: true });
    const steps = [
      { input: "a", output: "b" },
      { input: "c", output: "d" },
      { input: "e", output: "f" },
    ];
    const result = loop.run("prompt", steps);
    expect(result.map((s) => s.stepIndex)).toEqual([0, 1, 2]);
  });

  it("uses default options when none provided", () => {
    const loop = new ModelLoop();
    const steps = Array.from({ length: 15 }, (_, i) => ({ input: `i${i}`, output: `o${i}` }));
    const result = loop.run("prompt", steps);
    expect(result.length).toBeLessThanOrEqual(10);
  });

  it("each ModelStep has input, output, stepIndex", () => {
    const loop = new ModelLoop({ maxSteps: 1, stopOnError: false });
    const result = loop.run("prompt", [{ input: "x", output: "y" }]);
    expect(result[0]).toHaveProperty("stepIndex");
    expect(result[0]).toHaveProperty("input");
    expect(result[0]).toHaveProperty("output");
  });
});

describe("Planner", () => {
  let planner: Planner;

  beforeEach(() => {
    planner = new Planner();
  });

  it("returns a list of tool names", () => {
    const tools = ["read_file", "write_file", "exec_shell"];
    const plan = planner.plan("read a file", tools);
    expect(Array.isArray(plan)).toBe(true);
    expect(plan).toHaveLength(tools.length);
  });

  it("returns empty array for empty tools", () => {
    expect(planner.plan("do something", [])).toEqual([]);
  });

  it("all provided tools appear in the plan", () => {
    const tools = ["tool_a", "tool_b", "tool_c"];
    const plan = planner.plan("some goal", tools);
    for (const t of tools) {
      expect(plan).toContain(t);
    }
  });

  it("prioritizes tools whose name appears in the goal", () => {
    const tools = ["fetch_data", "write_file", "read_file"];
    const plan = planner.plan("fetch some data", tools);
    const fetchIdx = plan.indexOf("fetch_data");
    expect(fetchIdx).toBe(0);
  });

  it("handles goal with no matching tools", () => {
    const tools = ["compress", "encrypt"];
    const plan = planner.plan("delete something", tools);
    expect(plan).toHaveLength(2);
  });

  it("returns array of strings", () => {
    const plan = planner.plan("goal", ["tool1"]);
    expect(typeof plan[0]).toBe("string");
  });
});

describe("MemoryContextBuilder", () => {
  let builder: MemoryContextBuilder;

  beforeEach(() => {
    builder = new MemoryContextBuilder();
  });

  it("returns empty string for empty items array", () => {
    expect(builder.build([])).toBe("");
  });

  it("formats key: value pairs", () => {
    const items = [createMemoryItem("theme", "dark")];
    const result = builder.build(items);
    expect(result).toContain("theme");
    expect(result).toContain("dark");
  });

  it("formats multiple items", () => {
    const items = [
      createMemoryItem("key1", "val1"),
      createMemoryItem("key2", "val2"),
    ];
    const result = builder.build(items);
    expect(result).toContain("key1");
    expect(result).toContain("key2");
    expect(result).toContain("val1");
    expect(result).toContain("val2");
  });

  it("serializes object values as JSON", () => {
    const items = [createMemoryItem("data", { x: 1, y: 2 })];
    const result = builder.build(items);
    expect(result).toContain('"x"');
    expect(result).toContain('"y"');
  });

  it("serializes number values", () => {
    const items = [createMemoryItem("count", 42)];
    const result = builder.build(items);
    expect(result).toContain("42");
  });

  it("separates items with newlines", () => {
    const items = [
      createMemoryItem("a", "1"),
      createMemoryItem("b", "2"),
    ];
    const result = builder.build(items);
    expect(result.split("\n")).toHaveLength(2);
  });

  it("handles boolean values", () => {
    const items = [createMemoryItem("flag", true)];
    const result = builder.build(items);
    expect(result).toContain("true");
  });

  it("handles null values", () => {
    const items = [createMemoryItem("nothing", null)];
    const result = builder.build(items);
    expect(result).toContain("nothing");
  });
});
