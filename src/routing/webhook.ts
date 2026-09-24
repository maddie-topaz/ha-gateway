import type { Logger } from "../logger.js";
import type { EventConsumer } from "./event-router.js";

/** Where to POST events. URLs and secrets come from env vars so they stay out of the repo. See src/config/events.ts. */
export type WebhookDestination<TType extends string = string> = {
  readonly name: string;
  readonly events: readonly TType[];
  /** Env var holding the URL to POST to. If unset, this destination is disabled. */
  readonly urlEnv: string;
  /** Optional env var holding a secret, sent as `Authorization: Bearer <secret>`. */
  readonly secretEnv?: string;
};

type WebhookConsumerOptions = {
  name: string;
  events: readonly string[];
  url: string;
  secret: string | undefined;
  logger: Logger;
  timeoutMs?: number;
};

/** An EventConsumer that POSTs each accepted event as JSON. Failures are logged by the router. */
export const createWebhookConsumer = ({
  name,
  events,
  url,
  secret,
  logger,
  timeoutMs = 5_000,
}: WebhookConsumerOptions): EventConsumer => {
  const log = logger.child({ component: "webhook", webhook: name });
  // Log only the host: paths/queries may carry tokens.
  const host = new URL(url).host;

  return {
    name,
    accepts: (event) => events.includes(event.type),
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
