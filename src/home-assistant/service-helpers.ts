import type { CallService } from "./services.js";
import { HomeAssistantInvalidRequestError, type ServiceData } from "./types.js";

const ENTITY_ID = /^([a-z0-9_]+)\.[a-z0-9_]+$/;

/** "light.lounge" → "light". */
const domainOf = (entityId: string) => {
  const match = ENTITY_ID.exec(entityId);
  if (!match?.[1]) throw new HomeAssistantInvalidRequestError(`Invalid entity ID "${entityId}"`);
  return match[1];
};

/**
 * Convenience wrappers for common service calls. Each helper only builds the arguments for
 * `callService`, so sending, errors and logging stay in one place.
 *
 * To add a helper (setLight, activateScene, sendNotification, playMedia, …), write a function
 * here that calls `callService` or `callOnEntity` and add it to the returned object.
 *
 * These are for gateway code. Apps can't reach them directly: apps only get the
 * allowlisted actions defined in src/apps/.
 */
export const createServiceHelpers = (callService: CallService) => {
  /** Calls `<entity's domain>.<service>` on one entity, e.g. light.turn_on for light.lounge. */
  const callOnEntity = async (service: string, entityId: string, data?: ServiceData) =>
    callService({ domain: domainOf(entityId), service, target: { entity_id: entityId }, ...(data && { data }) });

  return {
    turnOn: (entityId: string, data?: ServiceData) => callOnEntity("turn_on", entityId, data),
    turnOff: (entityId: string) => callOnEntity("turn_off", entityId),
    toggle: (entityId: string) => callOnEntity("toggle", entityId),
  };
};

export type ServiceHelpers = ReturnType<typeof createServiceHelpers>;
