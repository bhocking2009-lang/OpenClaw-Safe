import { BaseChannel, NormalisedMessage } from "./base";
export declare class WebChatChannel extends BaseChannel {
    readonly channelName = "webchat";
    sendMessage(_recipientId: string, _text: string): Promise<void>;
    receiveMessage(payload: unknown): NormalisedMessage;
}
//# sourceMappingURL=webchat.d.ts.map