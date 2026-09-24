import type { EventType } from "../config/events.js";

/**
 * Application-level event the gateway publishes. This is the contract consumers
 * (Cam Quest, dashboards, …) depend on, so it deliberately hides raw HA payload shapes.
 * Event types are defined by the rules in src/config/events.ts.
 */
export type GatewayEvent<TType extends string = string> = {
  type: TType;
  entityId: string;
  /** Human-readable name from HA's friendly_name, if set. */
  name?: string;
  state: string;
  previousState: string | null;
  /** ISO 8601 timestamp of when the state changed in HA. */
  timestamp: string;
  /** Extra fields from the rule's `data` function. */
  data?: Record<string, unknown>;
};

export type NormalizedEvent = GatewayEvent<EventType>;
