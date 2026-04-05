import { BaseChannel, NormalisedMessage } from "./base";
export declare class WhatsAppChannel extends BaseChannel {
    private readonly accessToken;
    private readonly phoneNumberId;
    readonly channelName = "whatsapp";
    constructor(accessToken: string, phoneNumberId: string);
    sendMessage(_recipientId: string, _text: string): Promise<void>;
    receiveMessage(payload: unknown): NormalisedMessage;
}
//# sourceMappingURL=whatsapp.d.ts.map