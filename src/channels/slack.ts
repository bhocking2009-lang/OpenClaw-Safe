import { BaseChannel, NormalisedMessage } from "./base";

export class SlackChannel extends BaseChannel {
  readonly channelName = "slack";

  constructor(private readonly botToken: string, private readonly signingSecret: string) {
    super();
  }

  async sendMessage(_recipientId: string, _text: string): Promise<void> {
    throw new Error("SlackChannel.sendMessage requires a live bot token and HTTP client.");
  }

  receiveMessage(payload: unknown): NormalisedMessage {
    const p = payload as Record<string, unknown>;
    const event = (p["event"] ?? p) as Record<string, unknown>;
    return {
      senderId: String(event["user"] ?? ""),
      text: String(event["text"] ?? ""),
      channel: this.channelName,
      raw: payload,
    };
  }
}
