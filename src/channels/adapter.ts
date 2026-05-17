/**
 * Channel adapter interface for OpenClaw Secure.
 *
 * Each channel adapter is responsible only for:
 *   - ingress normalization
 *   - identity mapping
 *   - quoting/thread extraction
 *   - outbound formatting
 *   - transport retries
 *
 * The adapter must NOT decide tool policy or memory policy.
 * It emits a normalized InboundEnvelope.
 */

import { v4 as uuidv4 } from 'uuid';
import { InboundEnvelope, OutboundEnvelope } from '../core/types';

export interface ChannelAdapter {
  readonly channelName: string;

  /**
   * Normalize an incoming raw message into a typed InboundEnvelope.
   * The adapter resolves the sender to a channel-specific ref.
   * Principal resolution is performed by the gateway.
   */
  normalize(raw: unknown): InboundEnvelope;

  /**
   * Format and deliver an OutboundEnvelope via this channel.
   */
  send(envelope: OutboundEnvelope): Promise<void>;
}

// ---------------------------------------------------------------------------
// Stub channel adapter for testing
// ---------------------------------------------------------------------------

export class StubChannelAdapter implements ChannelAdapter {
  readonly channelName: string;
  public sent: OutboundEnvelope[] = [];

  constructor(name = 'stub') {
    this.channelName = name;
  }

  normalize(raw: unknown): InboundEnvelope {
    const msg = raw as { sender?: string; content?: string; sessionId?: string; principalId?: string };
    return {
      id: uuidv4(),
      channel: this.channelName,
      senderRef: msg.sender ?? 'unknown',
      principalId: msg.principalId,
      sessionId: msg.sessionId,
      content: msg.content ?? '',
      receivedAt: new Date().toISOString(),
    };
  }

  async send(envelope: OutboundEnvelope): Promise<void> {
    this.sent.push(envelope);
  }
}

// ---------------------------------------------------------------------------
// WebChat channel adapter (HTTP webhook-based)
// ---------------------------------------------------------------------------

export class WebChatChannelAdapter implements ChannelAdapter {
  readonly channelName = 'webchat';

  normalize(raw: unknown): InboundEnvelope {
    const msg = raw as {
      id?: string;
      userId?: string;
      threadId?: string;
      text?: string;
      attachments?: string[];
      sessionId?: string;
      principalId?: string;
    };
    return {
      id: msg.id ?? uuidv4(),
      channel: 'webchat',
      senderRef: msg.userId ?? 'anonymous',
      principalId: msg.principalId,
      sessionId: msg.sessionId,
      content: msg.text ?? '',
      attachments: msg.attachments,
      receivedAt: new Date().toISOString(),
    };
  }

  async send(envelope: OutboundEnvelope): Promise<void> {
    // In a real implementation, push to the WebSocket client for the given recipient.
    // For now, this is a no-op placeholder.
    void envelope;
  }
}
