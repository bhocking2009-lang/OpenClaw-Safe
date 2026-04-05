import { createPrincipal, PrincipalRole } from "../src/models/principal";
import { createAgentProfile, agentHasCapability } from "../src/models/agent_profile";
import { createSession } from "../src/models/session";
import { createTask, TaskStatus } from "../src/models/task";
import { createTaskStep } from "../src/models/task_step";
import { createMemoryItem } from "../src/models/memory_item";
import { createToolInvocation, InvocationStatus } from "../src/models/tool_invocation";
import { createApprovalRequest, ApprovalStatus } from "../src/models/approval_request";

describe("Models", () => {
  describe("Principal", () => {
    it("creates with a unique id", () => {
      const p1 = createPrincipal("Alice", PrincipalRole.OPERATOR);
      const p2 = createPrincipal("Bob", PrincipalRole.FAMILY);
      expect(p1.id).not.toBe(p2.id);
      expect(p1.role).toBe(PrincipalRole.OPERATOR);
    });
  });

  describe("AgentProfile", () => {
    it("reports capability presence correctly", () => {
      const profile = createAgentProfile("helper", "gpt-4", ["read_file"]);
      expect(agentHasCapability(profile, "read_file")).toBe(true);
      expect(agentHasCapability(profile, "write_file")).toBe(false);
    });
  });

  describe("Session", () => {
    it("starts active and can be closed", () => {
      const p = createPrincipal("Carol", PrincipalRole.TRUSTED_MEMBER);
      const a = createAgentProfile("bot", "model-x");
      const session = createSession(p, a);
      expect(session.active).toBe(true);
      session.active = false;
      expect(session.active).toBe(false);
    });
  });

  describe("Task", () => {
    it("starts PENDING and transitions", () => {
      const task = createTask("write a report");
      expect(task.status).toBe(TaskStatus.PENDING);
      task.status = TaskStatus.COMPLETED;
      expect(task.status).toBe(TaskStatus.COMPLETED);
    });

    it("accepts steps", () => {
      const task = createTask("multi-step");
      const step = createTaskStep("step 1");
      task.steps.push(step);
      expect(task.steps).toHaveLength(1);
    });
  });

  describe("ToolInvocation", () => {
    it("starts PENDING", () => {
      const inv = createToolInvocation("echo", { msg: "hi" });
      expect(inv.status).toBe(InvocationStatus.PENDING);
    });
  });

  describe("ApprovalRequest", () => {
    it("starts PENDING and can be approved", () => {
      const req = createApprovalRequest("inv-id", "test reason");
      expect(req.status).toBe(ApprovalStatus.PENDING);
      req.status = ApprovalStatus.APPROVED;
      req.resolvedAt = new Date();
      expect(req.status).toBe(ApprovalStatus.APPROVED);
      expect(req.resolvedAt).not.toBeNull();
    });
  });
});
