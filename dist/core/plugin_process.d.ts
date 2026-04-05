import { ScopedCapabilityToken } from "./scoped_token";
import { PluginSDKAPI } from "../sdk/plugin_sdk_api";
export declare enum PluginState {
    READY = "ready",
    RUNNING = "running",
    STOPPED = "stopped",
    ERROR = "error"
}
export type PluginTask = (sdk: PluginSDKAPI, args: Record<string, unknown>) => unknown;
export declare class PluginProcess {
    readonly pluginName: string;
    readonly token: ScopedCapabilityToken;
    readonly sdk: PluginSDKAPI;
    state: PluginState;
    constructor(pluginName: string, token: ScopedCapabilityToken, sdk: PluginSDKAPI);
    run(task: PluginTask, args?: Record<string, unknown>): unknown;
    stop(): void;
}
//# sourceMappingURL=plugin_process.d.ts.map