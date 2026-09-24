import type { Logger } from "../logger.js";
import type { GatewayEvent } from "./types.js";

/**
 * Something that wants events: an app's webhook, a logger, etc.
 * Set `app` to receive only that app's events; omit it to receive every app's events.
 */
export type EventConsumer = {
  name: string;
  app?: string;
  handle: (event: GatewayEvent, app: string) => void | Promise<void>;
};

/** Delivers each app's events to its consumers. A failing consumer never affects the others. */
export const createEventRouter = ({ logger }: { logger: Logger }) => {
  const log = logger.child({ component: "event-router" });
  const consumers = new Map<string, EventConsumer>();

  const register = (consumer: EventConsumer) => {
    if (consumers.has(consumer.name)) throw new Error(`Event consumer "${consumer.name}" is already registered`);
    consumers.set(consumer.name, consumer);
    log.info({ consumer: consumer.name, app: consumer.app }, "event consumer registered");
    return () => {
      consumers.delete(consumer.name);
    };
  };

  const deliver = async (consumer: EventConsumer, event: GatewayEvent, app: string) => {
    try {
      await consumer.handle(event, app);
    } catch (err) {
      log.error({ err, consumer: consumer.name, app, eventType: event.type }, "event consumer failed");
    }
  };

  const route = (app: string, event: GatewayEvent) => {
    for (const consumer of consumers.values()) {
      if (consumer.app === undefined || consumer.app === app) void deliver(consumer, event, app);
    }
  };

  return { register, route, consumers: () => [...consumers.keys()] };
};

export type EventRouter = ReturnType<typeof createEventRouter>;

/** Logs every app's events. */
export const createLogConsumer = (logger: Logger): EventConsumer => ({
  name: "log",
  handle: (event, app) => logger.info({ app, event }, "normalized event received"),
});
