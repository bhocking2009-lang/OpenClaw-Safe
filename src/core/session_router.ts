export class SessionRouter {
  private routes: Map<string, Map<string, string>> = new Map();

  register(channelName: string, senderId: string, sessionId: string): void {
    if (!this.routes.has(channelName)) {
      this.routes.set(channelName, new Map());
    }
    this.routes.get(channelName)!.set(senderId, sessionId);
  }

  lookup(channelName: string, senderId: string): string | undefined {
    return this.routes.get(channelName)?.get(senderId);
  }

  unregister(channelName: string, senderId: string): void {
    this.routes.get(channelName)?.delete(senderId);
  }
}
