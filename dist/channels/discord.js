"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DiscordChannel = void 0;
const base_1 = require("./base");
class DiscordChannel extends base_1.BaseChannel {
    botToken;
    applicationId;
    channelName = "discord";
    constructor(botToken, applicationId) {
        super();
        this.botToken = botToken;
        this.applicationId = applicationId;
    }
    async sendMessage(_recipientId, _text) {
        throw new Error("DiscordChannel.sendMessage requires a live bot token and HTTP client.");
    }
    receiveMessage(payload) {
        const p = payload;
        const author = (p["author"] ?? {});
        return {
            senderId: String(author["id"] ?? ""),
            text: String(p["content"] ?? ""),
            channel: this.channelName,
            raw: payload,
        };
    }
}
exports.DiscordChannel = DiscordChannel;
//# sourceMappingURL=discord.js.map