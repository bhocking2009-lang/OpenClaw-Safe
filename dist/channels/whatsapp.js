"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.WhatsAppChannel = void 0;
const base_1 = require("./base");
class WhatsAppChannel extends base_1.BaseChannel {
    accessToken;
    phoneNumberId;
    channelName = "whatsapp";
    constructor(accessToken, phoneNumberId) {
        super();
        this.accessToken = accessToken;
        this.phoneNumberId = phoneNumberId;
    }
    async sendMessage(_recipientId, _text) {
        throw new Error("WhatsAppChannel.sendMessage requires a live access token and HTTP client.");
    }
    receiveMessage(payload) {
        const p = payload;
        const entries = p["entry"] ?? [{}];
        const changes = entries[0]["changes"] ?? [{}];
        const value = changes[0]["value"] ?? {};
        const messages = value["messages"] ?? [{}];
        const msg = messages[0] ?? {};
        const textObj = msg["text"] ?? {};
        return {
            senderId: String(msg["from"] ?? ""),
            text: String(textObj["body"] ?? ""),
            channel: this.channelName,
            raw: payload,
        };
    }
}
exports.WhatsAppChannel = WhatsAppChannel;
//# sourceMappingURL=whatsapp.js.map