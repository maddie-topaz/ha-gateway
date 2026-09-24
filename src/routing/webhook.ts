import type { Logger } from "../logger.js";
import type { EventConsumer } from "./event-router.js";

type WebhookConsumerOptions = {
  app: string;
  url: string;
  secret: string | undefined;
  logger: Logger;
  timeoutMs?: number;
};

/** An EventConsumer that POSTs each of one app's events as JSON. Failures are logged by the router. */
export const createWebhookConsumer = ({ app, url, secret, logger, timeoutMs = 5_000 }: WebhookConsumerOptions): EventConsumer => {
  const log = logger.child({ component: "webhook", app });
  // Log only the host: paths/queries may carry tokens.
  const host = new URL(url).host;

  return {
    name: `${app}-webhook`,
    app,
    handle: async (event) => {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(secret && { authorization: `Bearer ${secret}` }),
        },
        body: JSON.stringify(event),
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!response.ok) throw new Error(`POST to ${host} responded ${response.status}`);
      log.info({ host, eventType: event.type, entityId: event.entityId }, "webhook delivered");
    },
  };
};
