import { BaseChannel, NormalisedMessage } from "./base";

export class WhatsAppChannel extends BaseChannel {
  readonly channelName = "whatsapp";

  constructor(private readonly accessToken: string, private readonly phoneNumberId: string) {
    super();
  }

  async sendMessage(_recipientId: string, _text: string): Promise<void> {
    throw new Error("WhatsAppChannel.sendMessage requires a live access token and HTTP client.");
  }

  receiveMessage(payload: unknown): NormalisedMessage {
    const p = payload as Record<string, unknown>;
    const entries = (p["entry"] as unknown[]) ?? [{}];
    const changes = ((entries[0] as Record<string, unknown>)["changes"] as unknown[]) ?? [{}];
    const value = (changes[0] as Record<string, unknown>)["value"] as Record<string, unknown> ?? {};
    const messages = (value["messages"] as unknown[]) ?? [{}];
    const msg = (messages[0] as Record<string, unknown>) ?? {};
    const textObj = (msg["text"] as Record<string, unknown>) ?? {};
    return {
      senderId: String(msg["from"] ?? ""),
      text: String(textObj["body"] ?? ""),
      channel: this.channelName,
      raw: payload,
    };
  }
}
