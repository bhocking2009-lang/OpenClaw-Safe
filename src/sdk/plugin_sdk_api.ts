import { ScopedCapabilityToken, tokenAllows } from "../core/scoped_token";

export type HandlerFn = (args: Record<string, unknown>) => unknown;

export class PluginSDKAPI {
  private handlers: Map<string, HandlerFn> = new Map();

  constructor(private readonly token: ScopedCapabilityToken) {}

  registerHandler(capability: string, fn: HandlerFn): void {
    this.handlers.set(capability, fn);
  }

  call(capability: string, args: Record<string, unknown> = {}): unknown {
    if (!tokenAllows(this.token, capability)) {
      throw new Error(
        `Capability '${capability}' is not granted by the current token (plugin=${this.token.pluginName}).`
      );
    }
    const fn = this.handlers.get(capability);
    if (!fn) {
      throw new Error(`No handler registered for capability '${capability}'.`);
    }
    return fn(args);
  }

  get grantedCapabilities(): string[] {
    return [...this.token.grantedCapabilities];
  }
}
