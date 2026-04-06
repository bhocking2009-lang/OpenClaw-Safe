import { FileBroker } from "../src/brokers/file_broker";
import { AuditLog } from "../src/core/audit_log";

describe("FileBroker", () => {
  let log: AuditLog;
  let broker: FileBroker;

  beforeEach(() => {
    log = new AuditLog();
    broker = new FileBroker(log);
  });

  afterEach(() => log.close());

  it("has toolClass = file", () => {
    expect(broker.toolClass).toBe("file");
  });

  it("has riskLevel = medium", () => {
    expect(broker.riskLevel).toBe("medium");
  });

  it("executes a read operation", () => {
    const result = broker.execute({ operation: "read", path: "/tmp/test.txt" }, "actor");
    expect(result.operation).toBe("read");
    expect(result.path).toBe("/tmp/test.txt");
  });

  it("executes a write operation with content", () => {
    const result = broker.execute(
      { operation: "write", path: "/tmp/out.txt", content: "hello" },
      "actor"
    );
    expect(result.operation).toBe("write");
    expect(result.content).toBe("hello");
  });

  it("defaults operation to read when not specified", () => {
    const result = broker.execute({ path: "/tmp/file.txt" }, "actor");
    expect(result.operation).toBe("read");
  });

  it("defaults path to empty string when not specified", () => {
    const result = broker.execute({}, "actor");
    expect(result.path).toBe("");
  });

  it("works without auditLog", () => {
    const brokerNoLog = new FileBroker();
    const result = brokerNoLog.execute({ operation: "read", path: "/x" }, "actor");
    expect(result.operation).toBe("read");
  });

  it("returns FileBrokerResult shape", () => {
    const result = broker.execute({ operation: "read", path: "/f" }, "actor");
    expect(result).toHaveProperty("operation");
    expect(result).toHaveProperty("path");
  });

  it("passes through content correctly", () => {
    const content = { data: [1, 2, 3] };
    const result = broker.execute({ operation: "write", path: "/f", content }, "actor");
    expect(result.content).toEqual(content);
  });

  it("handles multiple executions", () => {
    const r1 = broker.execute({ operation: "read", path: "/a" }, "a1");
    const r2 = broker.execute({ operation: "write", path: "/b", content: "x" }, "a2");
    expect(r1.operation).toBe("read");
    expect(r2.operation).toBe("write");
  });
});
