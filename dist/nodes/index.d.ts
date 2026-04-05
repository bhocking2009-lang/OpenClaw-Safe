import { Gateway } from "../core/gateway";
import { Session } from "../models/session";
import { Task } from "../models/task";
export declare abstract class BaseNode {
    abstract readonly nodeType: string;
    abstract dispatch(message: string, context?: Record<string, unknown>): Task;
}
export declare class DesktopNode extends BaseNode {
    private readonly gateway;
    private readonly session;
    readonly nodeType = "desktop";
    constructor(gateway: Gateway, session: Session);
    dispatch(message: string): Task;
}
export declare class MobileNode extends BaseNode {
    private readonly gateway;
    private readonly session;
    readonly nodeType = "mobile";
    constructor(gateway: Gateway, session: Session);
    dispatch(message: string): Task;
}
export declare class WebUINode extends BaseNode {
    private readonly gateway;
    private readonly session;
    readonly nodeType = "web_ui";
    constructor(gateway: Gateway, session: Session);
    dispatch(message: string): Task;
}
export declare class CLINode extends BaseNode {
    private readonly gateway;
    private readonly session;
    readonly nodeType = "cli";
    constructor(gateway: Gateway, session: Session);
    dispatch(message: string): Task;
}
//# sourceMappingURL=index.d.ts.map