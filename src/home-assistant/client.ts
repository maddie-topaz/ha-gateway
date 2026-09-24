import type { Logger } from "../logger.js";
import { createCommands } from "./commands.js";
import { createConnection } from "./connection.js";
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
  const commands = createCommands(connection);

  return {
    start: connection.start,
    stop: connection.stop,
    isConnected: connection.isConnected,
    getStatus: () => ({ ...connection.getStatus(), subscriptions: subscriptions.list() }),

    subscribeEvents: subscriptions.subscribeEvents,
    onStateChanged: (handler: (event: StateChangedEvent) => void) =>
      subscriptions.subscribeEvents<StateChangedData>("state_changed", handler),

    ...commands,
  };
};

export type HomeAssistantClient = ReturnType<typeof createHomeAssistantClient>;
