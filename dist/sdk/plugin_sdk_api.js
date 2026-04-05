"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PluginSDKAPI = void 0;
const scoped_token_1 = require("../core/scoped_token");
class PluginSDKAPI {
    token;
    handlers = new Map();
    constructor(token) {
        this.token = token;
    }
    registerHandler(capability, fn) {
        this.handlers.set(capability, fn);
    }
    call(capability, args = {}) {
        if (!(0, scoped_token_1.tokenAllows)(this.token, capability)) {
            throw new Error(`Capability '${capability}' is not granted by the current token (plugin=${this.token.pluginName}).`);
        }
        const fn = this.handlers.get(capability);
        if (!fn) {
            throw new Error(`No handler registered for capability '${capability}'.`);
        }
        return fn(args);
    }
    get grantedCapabilities() {
        return [...this.token.grantedCapabilities];
    }
}
exports.PluginSDKAPI = PluginSDKAPI;
//# sourceMappingURL=plugin_sdk_api.js.map