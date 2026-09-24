import type { Connection } from "./connection.js";
import type { CallServiceParams, CallServiceResult, HassEntityState } from "./types.js";

// HA domains and services are lowercase slugs. Rejecting anything else early keeps
// malformed input from future API endpoints away from HA.
const SLUG = /^[a-z0-9_]+$/;

export const createCommands = (connection: Connection) => {
  const callService = ({ domain, service, serviceData, target, returnResponse }: CallServiceParams) => {
    if (!SLUG.test(domain)) return Promise.reject(new Error(`Invalid service domain "${domain}"`));
    if (!SLUG.test(service)) return Promise.reject(new Error(`Invalid service name "${service}"`));

    return connection.sendCommand<CallServiceResult>({
      type: "call_service",
      domain,
      service,
      ...(serviceData && { service_data: serviceData }),
      ...(target && { target }),
      ...(returnResponse && { return_response: true }),
    });
  };

  const getStates = () => connection.sendCommand<HassEntityState[]>({ type: "get_states" });

  const getState = async (entityId: string) =>
    (await getStates()).find((state) => state.entity_id === entityId);

  return { callService, getStates, getState };
};
