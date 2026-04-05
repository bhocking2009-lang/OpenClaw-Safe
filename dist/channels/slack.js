"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SlackChannel = void 0;
const base_1 = require("./base");
class SlackChannel extends base_1.BaseChannel {
    botToken;
    signingSecret;
    channelName = "slack";
    constructor(botToken, signingSecret) {
        super();
        this.botToken = botToken;
        this.signingSecret = signingSecret;
    }
    async sendMessage(_recipientId, _text) {
        throw new Error("SlackChannel.sendMessage requires a live bot token and HTTP client.");
    }
    receiveMessage(payload) {
        const p = payload;
        const event = (p["event"] ?? p);
        return {
            senderId: String(event["user"] ?? ""),
            text: String(event["text"] ?? ""),
            channel: this.channelName,
            raw: payload,
        };
    }
}
exports.SlackChannel = SlackChannel;
//# sourceMappingURL=slack.js.map