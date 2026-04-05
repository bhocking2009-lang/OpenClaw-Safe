import crypto from "crypto";
import { Principal } from "./principal";
import { AgentProfile } from "./agent_profile";
import { Task } from "./task";
import { MemoryItem } from "./memory_item";

export interface Session {
  id: string;
  principal: Principal;
  agentProfile: AgentProfile;
  createdAt: Date;
  active: boolean;
  tasks: Task[];
  memory: MemoryItem[];
}

export function createSession(
  principal: Principal,
  agentProfile: AgentProfile
): Session {
  return {
    id: crypto.randomUUID(),
    principal,
    agentProfile,
    createdAt: new Date(),
    active: true,
    tasks: [],
    memory: [],
  };
}
