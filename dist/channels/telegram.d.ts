import { BaseChannel, NormalisedMessage } from "./base";
export declare class TelegramChannel extends BaseChannel {
    private readonly botToken;
    readonly channelName = "telegram";
    constructor(botToken: string);
    sendMessage(_recipientId: string, _text: string): Promise<void>;
    receiveMessage(payload: unknown): NormalisedMessage;
}
//# sourceMappingURL=telegram.d.ts.map