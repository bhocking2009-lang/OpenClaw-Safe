import { BaseChannel, NormalisedMessage } from "./base";

export class DiscordChannel extends BaseChannel {
  readonly channelName = "discord";

  constructor(private readonly botToken: string, private readonly applicationId: string) {
    super();
  }

  async sendMessage(_recipientId: string, _text: string): Promise<void> {
    throw new Error("DiscordChannel.sendMessage requires a live bot token and HTTP client.");
  }

  receiveMessage(payload: unknown): NormalisedMessage {
    const p = payload as Record<string, unknown>;
    const author = (p["author"] ?? {}) as Record<string, unknown>;
    return {
      senderId: String(author["id"] ?? ""),
      text: String(p["content"] ?? ""),
      channel: this.channelName,
      raw: payload,
    };
  }
}
