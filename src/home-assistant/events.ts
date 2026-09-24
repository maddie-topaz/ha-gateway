import type { NormalizedEvent } from "../routing/types.js";
import type { HassEntityState, StateChangedEvent } from "./types.js";

/** A state_changed event where the state value itself changed (not just attributes). */
export type StateTransition = {
  entityId: string;
  domain: string;
  deviceClass: string | undefined;
  from: HassEntityState | null;
  to: HassEntityState;
};

/** Turns a transition into an app-level event, or returns null if it doesn't apply. */
export type Normalizer = (transition: StateTransition) => NormalizedEvent | null;

const IGNORED_STATES = new Set(["unavailable", "unknown"]);

const baseFields = ({ entityId, from, to }: StateTransition) => ({
  entityId,
  ...(typeof to.attributes.friendly_name === "string" && { name: to.attributes.friendly_name }),
  state: to.state,
  previousState: from?.state ?? null,
  timestamp: to.last_changed,
});

const ZONE_DEVICE_CLASSES = new Set(["motion", "occupancy", "presence"]);

export const zoneActivity: Normalizer = (transition) =>
  transition.domain === "binary_sensor" && ZONE_DEVICE_CLASSES.has(transition.deviceClass ?? "")
    ? { type: "ZONE_ACTIVITY", ...baseFields(transition), active: transition.to.state === "on" }
    : null;

const CONTACT_DEVICE_CLASSES = new Set(["door", "window", "garage_door", "opening"]);

export const contactChanged: Normalizer = (transition) =>
  transition.domain === "binary_sensor" && CONTACT_DEVICE_CLASSES.has(transition.deviceClass ?? "")
    ? { type: "CONTACT_CHANGED", ...baseFields(transition), open: transition.to.state === "on" }
    : null;

export const defaultNormalizers: Normalizer[] = [zoneActivity, contactChanged];

/** Extracts a real state transition, filtering attribute-only updates, removals and unavailable/unknown noise. */
export const toTransition = (event: StateChangedEvent): StateTransition | null => {
  const { entity_id: entityId, old_state: from, new_state: to } = event.data ?? {};
  if (typeof entityId !== "string" || !to) return null;
  if (from && from.state === to.state) return null;
  if (IGNORED_STATES.has(to.state)) return null;

  const deviceClass = to.attributes?.device_class;
  return {
    entityId,
    domain: entityId.split(".", 1)[0] ?? "",
    deviceClass: typeof deviceClass === "string" ? deviceClass : undefined,
    from,
    to,
  };
};

/**
 * Builds a state_changed → NormalizedEvent function. The first normalizer that matches wins;
 * add new event types by writing a Normalizer and putting it in the list.
 */
export const createStateChangeNormalizer =
  (normalizers: Normalizer[] = defaultNormalizers) =>
  (event: StateChangedEvent): NormalizedEvent | null => {
    const transition = toTransition(event);
    if (!transition) return null;
    for (const normalize of normalizers) {
      const normalized = normalize(transition);
      if (normalized) return normalized;
    }
    return null;
  };
