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
export declare function createSession(principal: Principal, agentProfile: AgentProfile): Session;
//# sourceMappingURL=session.d.ts.map