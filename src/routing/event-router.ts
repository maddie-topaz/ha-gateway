import type { Logger } from "../logger.js";
import type { NormalizedEvent } from "./types.js";

/**
 * Something that wants normalized events: Cam Quest, a dashboard, a logger, etc.
 * `accepts` lets a consumer opt in to a subset; omit it to receive everything.
 */
export type EventConsumer = {
  name: string;
  accepts?: (event: NormalizedEvent) => boolean;
  handle: (event: NormalizedEvent) => void | Promise<void>;
};

/** Fans normalized events out to registered consumers. A failing consumer never affects the others. */
export const createEventRouter = ({ logger }: { logger: Logger }) => {
  const log = logger.child({ component: "event-router" });
  const consumers = new Map<string, EventConsumer>();

  const register = (consumer: EventConsumer) => {
    if (consumers.has(consumer.name)) throw new Error(`Event consumer "${consumer.name}" is already registered`);
    consumers.set(consumer.name, consumer);
    log.info({ consumer: consumer.name }, "event consumer registered");
    return () => {
      consumers.delete(consumer.name);
    };
  };

  const deliver = async (consumer: EventConsumer, event: NormalizedEvent) => {
    try {
      if (consumer.accepts && !consumer.accepts(event)) return;
      await consumer.handle(event);
    } catch (err) {
      log.error({ err, consumer: consumer.name, eventType: event.type }, "event consumer failed");
    }
  };

  const route = (event: NormalizedEvent) => {
    for (const consumer of consumers.values()) void deliver(consumer, event);
  };

  return { register, route, consumers: () => [...consumers.keys()] };
};

export type EventRouter = ReturnType<typeof createEventRouter>;

/** Logs every normalized event. Useful on its own until real consumers exist. */
export const createLogConsumer = (logger: Logger): EventConsumer => ({
  name: "log",
  handle: (event) => logger.info({ event }, "normalized event received"),
});
