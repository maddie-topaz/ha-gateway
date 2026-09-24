import type { Logger } from "../logger.js";
import type { Connection } from "./connection.js";
import type { HassEvent } from "./types.js";

type Subscription = {
  eventType: string;
  handler: (event: HassEvent) => void;
  /** HA's id for this subscription on the current connection; undefined while not active. */
  haId: number | undefined;
};

/**
 * Remembers what the gateway wants to be subscribed to and re-establishes it on every
 * (re)connect. HA subscription ids are per-connection, so they are dropped on disconnect.
 */
export const createSubscriptionRegistry = ({ connection, logger }: { connection: Connection; logger: Logger }) => {
  const log = logger.child({ component: "ha-subscriptions" });
  const subscriptions = new Set<Subscription>();

  const activate = async (subscription: Subscription) => {
    try {
      const haId = await connection.subscribe(
        { type: "subscribe_events", event_type: subscription.eventType },
        (event) => subscription.handler(event as HassEvent),
      );
      if (!subscriptions.has(subscription)) {
        // Unsubscribed while the request was in flight.
        await connection.unsubscribe(haId).catch(() => undefined);
        return;
      }
      subscription.haId = haId;
      log.info({ eventType: subscription.eventType, subscriptionId: haId }, "ha subscription created");
    } catch (err) {
      // If the connection dropped, onReady will retry after reconnect.
      log.error({ eventType: subscription.eventType, reason: (err as Error).message }, "ha subscription failed");
    }
  };

  connection.onReady(() => {
    for (const subscription of subscriptions) void activate(subscription);
  });

  connection.onDisconnect(() => {
    for (const subscription of subscriptions) subscription.haId = undefined;
  });

  /** Subscribe to a HA event type. Survives reconnects. Returns an unsubscribe function. */
  const subscribeEvents = <TData = Record<string, unknown>>(
    eventType: string,
    handler: (event: HassEvent<TData>) => void,
  ) => {
    const subscription: Subscription = { eventType, handler: handler as Subscription["handler"], haId: undefined };
    subscriptions.add(subscription);
    if (connection.isConnected()) void activate(subscription);

    return async () => {
      subscriptions.delete(subscription);
      const { haId } = subscription;
      subscription.haId = undefined;
      if (haId !== undefined && connection.isConnected()) await connection.unsubscribe(haId);
    };
  };

  return {
    subscribeEvents,
    list: () => [...subscriptions].map(({ eventType, haId }) => ({ eventType, active: haId !== undefined })),
  };
};
