"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.TelegramChannel = void 0;
const base_1 = require("./base");
class TelegramChannel extends base_1.BaseChannel {
    botToken;
    channelName = "telegram";
    constructor(botToken) {
        super();
        this.botToken = botToken;
    }
    async sendMessage(_recipientId, _text) {
        throw new Error("TelegramChannel.sendMessage requires a live bot token and HTTP client.");
    }
    receiveMessage(payload) {
        const p = payload;
        const msg = (p["message"] ?? p);
        const from = (msg["from"] ?? {});
        return {
            senderId: String(from["id"] ?? ""),
            text: String(msg["text"] ?? ""),
            channel: this.channelName,
            raw: payload,
        };
    }
}
exports.TelegramChannel = TelegramChannel;
//# sourceMappingURL=telegram.js.map