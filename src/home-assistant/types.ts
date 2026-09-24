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

export type ServiceTarget = {
  entity_id?: string | string[];
  device_id?: string | string[];
  area_id?: string | string[];
  floor_id?: string | string[];
  label_id?: string | string[];
};

export type CallServiceParams = {
  domain: string;
  service: string;
  serviceData?: Record<string, unknown>;
  target?: ServiceTarget;
  /** Ask HA to return the service's response data (only for services that support it). */
  returnResponse?: boolean;
};

export type CallServiceResult = {
  context: HassContext;
  response?: unknown;
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

export class HomeAssistantNotConnectedError extends Error {
  constructor() {
    super("Home Assistant is not connected");
    this.name = "HomeAssistantNotConnectedError";
  }
}

export class HomeAssistantTimeoutError extends Error {
  constructor(readonly commandType: string, timeoutMs: number) {
    super(`Home Assistant command "${commandType}" timed out after ${timeoutMs}ms`);
    this.name = "HomeAssistantTimeoutError";
  }
}

export class HomeAssistantCommandError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = "HomeAssistantCommandError";
  }
}
