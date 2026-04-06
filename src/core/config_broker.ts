import crypto from "crypto";

export class ConfigBroker {
  private config: Map<string, unknown> = new Map();
  private secrets: Map<string, string> = new Map(); // stored as hashed values

  set(key: string, value: unknown): void {
    this.config.set(key, value);
  }

  get(key: string): unknown {
    return this.config.get(key);
  }

  setSecret(key: string, value: string): void {
    const hash = crypto.createHash("sha256").update(value).digest("hex");
    this.secrets.set(key, hash);
  }

  hasSecret(key: string): boolean {
    return this.secrets.has(key);
  }

  delete(key: string): void {
    this.config.delete(key);
    this.secrets.delete(key);
  }
}
