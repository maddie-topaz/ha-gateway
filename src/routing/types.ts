/**
 * Application-level events the gateway publishes. This is the contract consumers
 * (Cam Quest, dashboards, …) depend on, so it deliberately hides raw HA payload shapes.
 */

type EntityEventBase = {
  entityId: string;
  /** Human-readable name from HA's friendly_name, if set. */
  name?: string;
  state: string;
  previousState: string | null;
  /** ISO 8601 timestamp of when the state changed in HA. */
  timestamp: string;
};

/** Motion, occupancy or presence detected / cleared. */
export type ZoneActivityEvent = EntityEventBase & { type: "ZONE_ACTIVITY"; active: boolean };

/** Door, window, garage door or other opening opened / closed. */
export type ContactChangedEvent = EntityEventBase & { type: "CONTACT_CHANGED"; open: boolean };

export type NormalizedEvent = ZoneActivityEvent | ContactChangedEvent;

export type NormalizedEventType = NormalizedEvent["type"];
