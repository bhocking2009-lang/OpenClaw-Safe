import { BaseChannel, NormalisedMessage } from "./base";
export declare class SlackChannel extends BaseChannel {
    private readonly botToken;
    private readonly signingSecret;
    readonly channelName = "slack";
    constructor(botToken: string, signingSecret: string);
    sendMessage(_recipientId: string, _text: string): Promise<void>;
    receiveMessage(payload: unknown): NormalisedMessage;
}
//# sourceMappingURL=slack.d.ts.map