import { BaseChannel, NormalisedMessage } from "./base";

export class TelegramChannel extends BaseChannel {
  readonly channelName = "telegram";

  constructor(private readonly botToken: string) {
    super();
  }

  async sendMessage(_recipientId: string, _text: string): Promise<void> {
    throw new Error(
      "TelegramChannel.sendMessage requires a live bot token and HTTP client."
    );
  }

  receiveMessage(payload: unknown): NormalisedMessage {
    const p = payload as Record<string, unknown>;
    const msg = (p["message"] ?? p) as Record<string, unknown>;
    const from = (msg["from"] ?? {}) as Record<string, unknown>;
    return {
      senderId: String(from["id"] ?? ""),
      text: String(msg["text"] ?? ""),
      channel: this.channelName,
      raw: payload,
    };
  }
}
