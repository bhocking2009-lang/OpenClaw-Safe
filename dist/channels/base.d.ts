export interface NormalisedMessage {
    senderId: string;
    text: string;
    channel: string;
    raw: unknown;
}
export declare abstract class BaseChannel {
    abstract readonly channelName: string;
    abstract sendMessage(recipientId: string, text: string): Promise<void>;
    abstract receiveMessage(payload: unknown): NormalisedMessage;
}
//# sourceMappingURL=base.d.ts.map