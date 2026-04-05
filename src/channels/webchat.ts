import { BaseChannel, NormalisedMessage } from "./base";

export class WebChatChannel extends BaseChannel {
  readonly channelName = "webchat";

  async sendMessage(_recipientId: string, _text: string): Promise<void> {
    throw new Error("WebChatChannel.sendMessage requires a live WebSocket/SSE connection.");
  }

  receiveMessage(payload: unknown): NormalisedMessage {
    const p = payload as Record<string, unknown>;
    return {
      senderId: String(p["user_id"] ?? ""),
      text: String(p["message"] ?? ""),
      channel: this.channelName,
      raw: payload,
    };
  }
}
