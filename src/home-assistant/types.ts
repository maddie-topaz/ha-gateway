// Shapes from the Home Assistant WebSocket API: https://developers.home-assistant.io/docs/api/websocket

export type HassContext = {
  id: string;
  parent_id: string | null;
  user_id: string | null;
};

export type HassEntityState = {
  entity_id: string;
  state: string;
  attributes: Record<string, unknown>;
  last_changed: string;
  last_updated: string;
  context: HassContext;
};

export type HassEvent<TData = Record<string, unknown>> = {
  event_type: string;
  data: TData;
  origin: string;
  time_fired: string;
  context: HassContext;
};

export type StateChangedData = {
  entity_id: string;
  old_state: HassEntityState | null;
  new_state: HassEntityState | null;
};

export type StateChangedEvent = HassEvent<StateChangedData>;

/** Anything that survives a JSON round trip, which is all HA can accept or return. */
export type JsonValue =
  | string
  | number
  | boolean
  | null
  | readonly JsonValue[]
  | { readonly [key: string]: JsonValue };

type OneOrMany = string | readonly string[];

/** Which entities, devices, areas, floors or labels a service call applies to. */
export type ServiceTarget = {
  entity_id?: OneOrMany;
  device_id?: OneOrMany;
  area_id?: OneOrMany;
  floor_id?: OneOrMany;
  label_id?: OneOrMany;
};

/** Service-specific fields, e.g. `{ brightness_pct: 30, rgb_color: [145, 50, 255] }`. */
export type ServiceData = { readonly [key: string]: JsonValue };

export type CallServiceParams = {
  domain: string;
  service: string;
  target?: ServiceTarget;
  data?: ServiceData;
  /** Ask HA to return the service's response data (only for services that support it). */
  returnResponse?: boolean;
};

export type CallServiceResult = {
  context: HassContext;
  /** Only present when `returnResponse` was set and the service returns data. */
  response?: JsonValue;
};

/** A client→HA command, minus the `id` the connection assigns. */
export type OutgoingCommand = { type: string } & Record<string, unknown>;

export type IncomingMessage =
  | { type: "auth_required"; ha_version: string }
  | { type: "auth_ok"; ha_version: string }
  | { type: "auth_invalid"; message: string }
  | { type: "result"; id: number; success: true; result: unknown }
  | { type: "result"; id: number; success: false; error: { code: string; message: string } }
  | { type: "event"; id: number; event: unknown }
  | { type: "pong"; id: number };

export type ConnectionStatus =
  | "idle"
  | "connecting"
  | "authenticating"
  | "connected"
  | "disconnected"
  | "auth_failed"
  | "stopped";

/**
 * Base class for every Home Assistant failure, so callers can catch them all with one
 * `instanceof HomeAssistantError` and branch on the subclass when they need detail.
 */
export class HomeAssistantError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = new.target.name;
  }
}

/** The gateway has no authenticated connection to HA right now. Safe to retry later. */
export class HomeAssistantNotConnectedError extends HomeAssistantError {
  constructor() {
    super("Home Assistant is not connected");
  }
}

/** HA didn't answer in time. The command may or may not have run. */
export class HomeAssistantTimeoutError extends HomeAssistantError {
  constructor(readonly commandType: string, timeoutMs: number) {
    super(`Home Assistant command "${commandType}" timed out after ${timeoutMs}ms`);
  }
}

/** HA answered with an error, e.g. `service_not_found` or `invalid_format`. */
export class HomeAssistantCommandError extends HomeAssistantError {
  constructor(readonly code: string, message: string) {
    super(message);
  }
}

/** HA answered, but not in the shape the API promises. */
export class HomeAssistantInvalidResponseError extends HomeAssistantError {}

/** The request was rejected before being sent to HA, e.g. a malformed service or entity ID. */
export class HomeAssistantInvalidRequestError extends HomeAssistantError {}
