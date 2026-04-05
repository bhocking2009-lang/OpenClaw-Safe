"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.WebChatChannel = void 0;
const base_1 = require("./base");
class WebChatChannel extends base_1.BaseChannel {
    channelName = "webchat";
    async sendMessage(_recipientId, _text) {
        throw new Error("WebChatChannel.sendMessage requires a live WebSocket/SSE connection.");
    }
    receiveMessage(payload) {
        const p = payload;
        return {
            senderId: String(p["user_id"] ?? ""),
            text: String(p["message"] ?? ""),
            channel: this.channelName,
            raw: payload,
        };
    }
}
exports.WebChatChannel = WebChatChannel;
//# sourceMappingURL=webchat.js.map