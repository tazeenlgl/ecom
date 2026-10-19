import type { Config } from './config/env.js';
import type { Database } from './db/client.js';
import type { MessageSender } from './modules/notifications/sender.js';
import type { PaymentProviders } from './modules/payments/provider.js';
import type { DomainVerifier } from './modules/platform/domain-verifier.js';
import type { PosGateway } from './modules/pos/gateway.js';

/** Everything a module needs from the outside world, injected so tests can substitute fakes. */
export type AppContext = {
  config: Config;
  db: Database;
  pos: PosGateway;
  payments: PaymentProviders;
  messages: MessageSender;
  dns: DomainVerifier;
  now: () => Date;
};
