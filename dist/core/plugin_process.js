"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PluginProcess = exports.PluginState = void 0;
const scoped_token_1 = require("./scoped_token");
var PluginState;
(function (PluginState) {
    PluginState["READY"] = "ready";
    PluginState["RUNNING"] = "running";
    PluginState["STOPPED"] = "stopped";
    PluginState["ERROR"] = "error";
})(PluginState || (exports.PluginState = PluginState = {}));
class PluginProcess {
    pluginName;
    token;
    sdk;
    state = PluginState.READY;
    constructor(pluginName, token, sdk) {
        this.pluginName = pluginName;
        this.token = token;
        this.sdk = sdk;
    }
    run(task, args = {}) {
        if (!(0, scoped_token_1.isTokenValid)(this.token)) {
            this.state = PluginState.ERROR;
            throw new Error(`Plugin '${this.pluginName}': capability token has expired.`);
        }
        this.state = PluginState.RUNNING;
        try {
            const result = task(this.sdk, args);
            this.state = PluginState.READY;
            return result;
        }
        catch (err) {
            this.state = PluginState.ERROR;
            throw err;
        }
    }
    stop() {
        this.state = PluginState.STOPPED;
    }
}
exports.PluginProcess = PluginProcess;
//# sourceMappingURL=plugin_process.js.map