import { ScopedCapabilityToken } from "../core/scoped_token";
export type HandlerFn = (args: Record<string, unknown>) => unknown;
export declare class PluginSDKAPI {
    private readonly token;
    private handlers;
    constructor(token: ScopedCapabilityToken);
    registerHandler(capability: string, fn: HandlerFn): void;
    call(capability: string, args?: Record<string, unknown>): unknown;
    get grantedCapabilities(): string[];
}
//# sourceMappingURL=plugin_sdk_api.d.ts.map