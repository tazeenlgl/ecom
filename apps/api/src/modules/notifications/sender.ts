import type { FastifyBaseLogger } from 'fastify';

/**
 * Port for customer messages (OTP, order and shipping updates).
 *
 * Only `LogMessageSender` exists: it records that a message *would* be sent,
 * with the recipient masked and without message variables, so OTP codes never
 * reach logs. A real SMS/email/WhatsApp adapter needs provider approval first
 * (docs/KNOWN_ISSUES.md).
 */
export type OutboundMessage = {
  channel: 'sms' | 'email';
  to: string;
  /** Template identifier, e.g. 'otp.login', 'order.confirmed'. */
  template: string;
  /** Template variables. May contain secrets such as an OTP code; adapters must not log them. */
  variables: Record<string, string>;
};

export interface MessageSender {
  readonly name: string;
  send(message: OutboundMessage): Promise<void>;
}

export const maskRecipient = (to: string): string =>
  to.includes('@') ? to.replace(/^(.).*(@.*)$/, '$1***$2') : to.replace(/.(?=.{4})/g, '*');

export class LogMessageSender implements MessageSender {
  readonly name = 'log';
  /** Messages "sent" in this process; tests read OTP codes from here. Never exposed over HTTP. */
  readonly outbox: OutboundMessage[] = [];

  constructor(private readonly log: Pick<FastifyBaseLogger, 'info'>) {}

  async send(message: OutboundMessage): Promise<void> {
    this.outbox.push(message);
    if (this.outbox.length > 1000) this.outbox.shift();
    this.log.info(
      { channel: message.channel, to: maskRecipient(message.to), template: message.template },
      'message not delivered: log-only sender',
    );
  }
}

/** Used when SMS_PROVIDER=disabled: every send fails, so OTP endpoints report the outage. */
export class DisabledMessageSender implements MessageSender {
  readonly name = 'disabled';
  async send(): Promise<void> {
    throw new Error('Message delivery is disabled');
  }
}
