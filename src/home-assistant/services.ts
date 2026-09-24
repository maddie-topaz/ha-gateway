import type { Logger } from "../logger.js";
import type { Connection } from "./connection.js";
import {
  HomeAssistantCommandError,
  HomeAssistantError,
  HomeAssistantInvalidRequestError,
  HomeAssistantInvalidResponseError,
  type CallServiceParams,
  type CallServiceResult,
} from "./types.js";

/** The part of the connection callService needs. Narrow so tests can pass a fake. */
export type ServiceTransport = Pick<Connection, "sendCommand">;

// HA domains and services are lowercase slugs. Rejecting anything else early keeps
// malformed input away from HA.
const SLUG = /^[a-z0-9_]+$/;

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null;

const isCallServiceResult = (value: unknown): value is CallServiceResult =>
  isObject(value) && isObject(value.context) && typeof value.context.id === "string";

/**
 * Builds the one function every Home Assistant service call goes through, over the
 * gateway's existing authenticated WebSocket connection.
 *
 * Every failure rejects with a HomeAssistantError subclass:
 * - HomeAssistantInvalidRequestError: malformed domain or service, nothing was sent
 * - HomeAssistantNotConnectedError: no connection to HA right now
 * - HomeAssistantTimeoutError: HA didn't answer in time
 * - HomeAssistantCommandError: HA rejected the call (`code` has HA's error code)
 * - HomeAssistantInvalidResponseError: HA answered with something unexpected
 */
export const createServiceCaller = ({ transport, logger }: { transport: ServiceTransport; logger: Logger }) => {
  const log = logger.child({ component: "ha-services" });

  return async ({ domain, service, target, data, returnResponse }: CallServiceParams): Promise<CallServiceResult> => {
    const name = `${domain}.${service}`;
    if (!SLUG.test(domain) || !SLUG.test(service)) {
      throw new HomeAssistantInvalidRequestError(
        `Invalid service "${name}": domain and service must be lowercase letters, numbers and underscores`,
      );
    }

    // Log data keys but never values: they can hold message text or other personal content.
    const logFields = { service: name, target, dataKeys: data && Object.keys(data) };
    const started = performance.now();

    let result: unknown;
    try {
      result = await transport.sendCommand({
        type: "call_service",
        domain,
        service,
        ...(target && { target }),
        ...(data && { service_data: data }),
        ...(returnResponse && { return_response: true }),
      });
    } catch (err) {
      const error =
        err instanceof HomeAssistantError
          ? err
          : new HomeAssistantError(`${name} failed: ${err instanceof Error ? err.message : String(err)}`, { cause: err });
      log.warn(
        {
          ...logFields,
          error: error.name,
          reason: error.message,
          ...(error instanceof HomeAssistantCommandError && { code: error.code }),
        },
        "ha service call failed",
      );
      throw error;
    }

    if (!isCallServiceResult(result)) {
      log.warn(logFields, "ha service call returned an invalid response");
      throw new HomeAssistantInvalidResponseError(`${name} returned a response without a context`);
    }

    log.debug({ ...logFields, ms: Math.round(performance.now() - started) }, "ha service called");
    return result;
  };
};

export type CallService = ReturnType<typeof createServiceCaller>;
