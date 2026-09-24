import type { Logger } from "../logger.js";
import { createConnection } from "./connection.js";
import { createServiceHelpers } from "./service-helpers.js";
import { createServiceCaller } from "./services.js";
import { createStateQueries } from "./states.js";
import { createSubscriptionRegistry } from "./subscriptions.js";
import type { StateChangedData, StateChangedEvent } from "./types.js";

type HomeAssistantClientOptions = {
  websocketUrl: string;
  token: string;
  logger: Logger;
};

/** The single entry point the rest of the gateway uses to talk to Home Assistant. */
export const createHomeAssistantClient = ({ websocketUrl, token, logger }: HomeAssistantClientOptions) => {
  const connection = createConnection({ url: websocketUrl, token, logger });
  const subscriptions = createSubscriptionRegistry({ connection, logger });
  const callService = createServiceCaller({ transport: connection, logger });

  return {
    start: connection.start,
    stop: connection.stop,
    isConnected: connection.isConnected,
    getStatus: () => ({ ...connection.getStatus(), subscriptions: subscriptions.list() }),

    subscribeEvents: subscriptions.subscribeEvents,
    onStateChanged: (handler: (event: StateChangedEvent) => void) =>
      subscriptions.subscribeEvents<StateChangedData>("state_changed", handler),

    /** Generic service call. Everything below is built on it. */
    callService,
    ...createServiceHelpers(callService),
    ...createStateQueries(connection),
  };
};

export type HomeAssistantClient = ReturnType<typeof createHomeAssistantClient>;
