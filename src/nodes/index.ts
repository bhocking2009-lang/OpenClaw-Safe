import { Gateway } from "../core/gateway";
import { Session } from "../models/session";
import { Task } from "../models/task";

export abstract class BaseNode {
  abstract readonly nodeType: string;
  abstract dispatch(message: string, context?: Record<string, unknown>): Task;
}

export class DesktopNode extends BaseNode {
  readonly nodeType = "desktop";
  constructor(private readonly gateway: Gateway, private readonly session: Session) {
    super();
  }
  dispatch(message: string): Task {
    return this.gateway.createTask(this.session, message);
  }
}

export class MobileNode extends BaseNode {
  readonly nodeType = "mobile";
  constructor(private readonly gateway: Gateway, private readonly session: Session) {
    super();
  }
  dispatch(message: string): Task {
    return this.gateway.createTask(this.session, message);
  }
}

export class WebUINode extends BaseNode {
  readonly nodeType = "web_ui";
  constructor(private readonly gateway: Gateway, private readonly session: Session) {
    super();
  }
  dispatch(message: string): Task {
    return this.gateway.createTask(this.session, message);
  }
}

export class CLINode extends BaseNode {
  readonly nodeType = "cli";
  constructor(private readonly gateway: Gateway, private readonly session: Session) {
    super();
  }
  dispatch(message: string): Task {
    return this.gateway.createTask(this.session, message);
  }
}
