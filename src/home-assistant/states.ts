import type { Connection } from "./connection.js";
import type { HassEntityState } from "./types.js";

/** Read-only queries for entity state. Service calls live in services.ts. */
export const createStateQueries = (connection: Pick<Connection, "sendCommand">) => {
  const getStates = () => connection.sendCommand<HassEntityState[]>({ type: "get_states" });

  const getState = async (entityId: string) =>
    (await getStates()).find((state) => state.entity_id === entityId);

  return { getStates, getState };
};
