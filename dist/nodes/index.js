"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CLINode = exports.WebUINode = exports.MobileNode = exports.DesktopNode = exports.BaseNode = void 0;
class BaseNode {
}
exports.BaseNode = BaseNode;
class DesktopNode extends BaseNode {
    gateway;
    session;
    nodeType = "desktop";
    constructor(gateway, session) {
        super();
        this.gateway = gateway;
        this.session = session;
    }
    dispatch(message) {
        return this.gateway.createTask(this.session, message);
    }
}
exports.DesktopNode = DesktopNode;
class MobileNode extends BaseNode {
    gateway;
    session;
    nodeType = "mobile";
    constructor(gateway, session) {
        super();
        this.gateway = gateway;
        this.session = session;
    }
    dispatch(message) {
        return this.gateway.createTask(this.session, message);
    }
}
exports.MobileNode = MobileNode;
class WebUINode extends BaseNode {
    gateway;
    session;
    nodeType = "web_ui";
    constructor(gateway, session) {
        super();
        this.gateway = gateway;
        this.session = session;
    }
    dispatch(message) {
        return this.gateway.createTask(this.session, message);
    }
}
exports.WebUINode = WebUINode;
class CLINode extends BaseNode {
    gateway;
    session;
    nodeType = "cli";
    constructor(gateway, session) {
        super();
        this.gateway = gateway;
        this.session = session;
    }
    dispatch(message) {
        return this.gateway.createTask(this.session, message);
    }
}
exports.CLINode = CLINode;
//# sourceMappingURL=index.js.map