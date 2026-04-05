import { BaseChannel, NormalisedMessage } from "./base";
export declare class DiscordChannel extends BaseChannel {
    private readonly botToken;
    private readonly applicationId;
    readonly channelName = "discord";
    constructor(botToken: string, applicationId: string);
    sendMessage(_recipientId: string, _text: string): Promise<void>;
    receiveMessage(payload: unknown): NormalisedMessage;
}
//# sourceMappingURL=discord.d.ts.map