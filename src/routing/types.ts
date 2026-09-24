/**
 * Application-level event the gateway publishes. This is the contract apps
 * depend on, so it deliberately hides raw HA payload shapes. Event types come
 * from each app's rules in src/apps/.
 */
export type GatewayEvent<TType extends string = string> = StateChangeEvent<TType> | CustomEvent<TType>;

/** An event from a HA entity changing state (a StateRule matched). */
export type StateChangeEvent<TType extends string = string> = {
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

/** An event from a custom HA event, e.g. one fired by an automation (a CustomEventRule matched). No entity involved. */
export type CustomEvent<TType extends string = string> = {
  type: TType;
  /** ISO 8601 timestamp of when HA fired the event. */
  timestamp: string;
  /** The HA event's data, or the rule's `data` function's output. */
  data: Record<string, unknown>;
};
