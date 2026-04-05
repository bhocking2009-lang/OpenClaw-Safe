import { ScopedCapabilityToken, isTokenValid } from "./scoped_token";
import { PluginSDKAPI } from "../sdk/plugin_sdk_api";

export enum PluginState {
  READY = "ready",
  RUNNING = "running",
  STOPPED = "stopped",
  ERROR = "error",
}

export type PluginTask = (sdk: PluginSDKAPI, args: Record<string, unknown>) => unknown;

export class PluginProcess {
  state: PluginState = PluginState.READY;

  constructor(
    public readonly pluginName: string,
    public readonly token: ScopedCapabilityToken,
    public readonly sdk: PluginSDKAPI
  ) {}

  run(task: PluginTask, args: Record<string, unknown> = {}): unknown {
    if (!isTokenValid(this.token)) {
      this.state = PluginState.ERROR;
      throw new Error(`Plugin '${this.pluginName}': capability token has expired.`);
    }
    this.state = PluginState.RUNNING;
    try {
      const result = task(this.sdk, args);
      this.state = PluginState.READY;
      return result;
    } catch (err) {
      this.state = PluginState.ERROR;
      throw err;
    }
  }

  stop(): void {
    this.state = PluginState.STOPPED;
  }
}
