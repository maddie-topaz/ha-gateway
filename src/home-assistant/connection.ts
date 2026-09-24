import WebSocket from "ws";
import type { Logger } from "../logger.js";
import {
  HomeAssistantCommandError,
  HomeAssistantNotConnectedError,
  HomeAssistantTimeoutError,
  type ConnectionStatus,
  type IncomingMessage,
  type OutgoingCommand,
} from "./types.js";

type BackoffOptions = { initialDelayMs: number; maxDelayMs: number };

type ConnectionOptions = {
  url: string;
  token: string;
  logger: Logger;
  backoff?: BackoffOptions;
  commandTimeoutMs?: number;
  /** How often to ping HA to detect half-open connections. */
  heartbeatIntervalMs?: number;
  handshakeTimeoutMs?: number;
};

type PendingCommand = {
  type: string;
  resolve: (result: unknown) => void;
  reject: (err: Error) => void;
  timer: NodeJS.Timeout;
};

type EventHandler = (event: unknown) => void;

const DEFAULT_BACKOFF: BackoffOptions = { initialDelayMs: 1_000, maxDelayMs: 60_000 };
const STOP_TIMEOUT_MS = 3_000;

/** Exponential backoff with jitter in [delay/2, delay] so many clients don't retry in lockstep. */
const backoffDelay = (attempt: number, { initialDelayMs, maxDelayMs }: BackoffOptions) => {
  const delay = Math.min(maxDelayMs, initialDelayMs * 2 ** (attempt - 1));
  return Math.round(delay / 2 + Math.random() * (delay / 2));
};

const isIncomingMessage = (value: unknown): value is IncomingMessage =>
  typeof value === "object" && value !== null && typeof (value as { type?: unknown }).type === "string";

/**
 * Owns the raw WebSocket to Home Assistant: authentication, request/response correlation,
 * event dispatch by subscription id, heartbeats, and reconnect with exponential backoff.
 * Nothing outside src/home-assistant should need to know the wire protocol.
 */
export const createConnection = ({
  url,
  token,
  logger,
  backoff = DEFAULT_BACKOFF,
  commandTimeoutMs = 10_000,
  heartbeatIntervalMs = 30_000,
  handshakeTimeoutMs = 10_000,
}: ConnectionOptions) => {
  const log = logger.child({ component: "ha-connection" });
  const target = new URL(url).host;

  let socket: WebSocket | undefined;
  let status: ConnectionStatus = "idle";
  let haVersion: string | undefined;
  let connectedSince: Date | undefined;
  let hasConnectedBefore = false;
  let attempt = 0;
  let nextId = 1;
  let reconnectTimer: NodeJS.Timeout | undefined;
  let heartbeatTimer: NodeJS.Timeout | undefined;

  const pending = new Map<number, PendingCommand>();
  const eventHandlers = new Map<number, EventHandler>();
  const readyListeners = new Set<() => void>();
  const disconnectListeners = new Set<() => void>();

  const notify = (listeners: Set<() => void>) => {
    for (const listener of listeners) {
      try {
        listener();
      } catch (err) {
        log.error({ err }, "ha connection listener threw");
      }
    }
  };

  const send = (ws: WebSocket, payload: Record<string, unknown>) =>
    new Promise<void>((resolve, reject) => ws.send(JSON.stringify(payload), (err) => (err ? reject(err) : resolve())));

  const request = <T>(command: OutgoingCommand, onEvent?: EventHandler) => {
    const ws = socket;
    if (status !== "connected" || !ws) return { id: -1, result: Promise.reject(new HomeAssistantNotConnectedError()) };

    const id = nextId++;
    if (onEvent) eventHandlers.set(id, onEvent);

    const result = new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        eventHandlers.delete(id);
        reject(new HomeAssistantTimeoutError(command.type, commandTimeoutMs));
      }, commandTimeoutMs);
      pending.set(id, { type: command.type, resolve: resolve as (r: unknown) => void, reject, timer });

      send(ws, { ...command, id }).catch((err: Error) => {
        clearTimeout(timer);
        pending.delete(id);
        eventHandlers.delete(id);
        reject(err);
      });
    });

    return { id, result };
  };

  const settle = (id: number, outcome: { ok: true; value: unknown } | { ok: false; error: Error }) => {
    const entry = pending.get(id);
    if (!entry) return;
    pending.delete(id);
    clearTimeout(entry.timer);
    if (outcome.ok) entry.resolve(outcome.value);
    else {
      eventHandlers.delete(id);
      entry.reject(outcome.error);
    }
  };

  const rejectAllPending = (err: Error) => {
    for (const [id, entry] of pending) {
      clearTimeout(entry.timer);
      entry.reject(err);
      pending.delete(id);
    }
  };

  const startHeartbeat = (ws: WebSocket) => {
    stopHeartbeat();
    heartbeatTimer = setInterval(() => {
      request({ type: "ping" }).result.catch((err: Error) => {
        if (ws !== socket) return;
        log.warn({ reason: err.message }, "ha heartbeat failed, dropping connection");
        ws.terminate();
      });
    }, heartbeatIntervalMs);
  };

  const stopHeartbeat = () => {
    clearInterval(heartbeatTimer);
    heartbeatTimer = undefined;
  };

  const handleMessage = (ws: WebSocket, message: IncomingMessage) => {
    switch (message.type) {
      case "auth_required":
        status = "authenticating";
        haVersion = message.ha_version;
        // Never log this payload.
        send(ws, { type: "auth", access_token: token }).catch((err: Error) =>
          log.warn({ reason: err.message }, "ha failed to send auth"),
        );
        return;

      case "auth_ok": {
        const isReconnect = hasConnectedBefore;
        status = "connected";
        haVersion = message.ha_version;
        connectedSince = new Date();
        hasConnectedBefore = true;
        attempt = 0;
        log.info({ target, haVersion }, "ha authenticated");
        if (isReconnect) log.info({ target }, "ha reconnected");
        startHeartbeat(ws);
        notify(readyListeners);
        return;
      }

      case "auth_invalid":
        // Retrying a bad token just risks HA's IP ban, so stop and surface it via /health.
        status = "auth_failed";
        log.error({ target, reason: message.message }, "ha authentication failed, check HA_TOKEN; not retrying");
        ws.close(1000);
        return;

      case "result":
        if (message.success) settle(message.id, { ok: true, value: message.result });
        else settle(message.id, { ok: false, error: new HomeAssistantCommandError(message.error.code, message.error.message) });
        return;

      case "pong":
        settle(message.id, { ok: true, value: undefined });
        return;

      case "event": {
        const handler = eventHandlers.get(message.id);
        if (!handler) return;
        try {
          handler(message.event);
        } catch (err) {
          log.error({ err, subscriptionId: message.id }, "ha event handler threw");
        }
        return;
      }

      default:
        log.debug({ type: (message as { type: string }).type }, "ha unhandled message type");
    }
  };

  const handleRawMessage = (ws: WebSocket, data: WebSocket.RawData) => {
    if (ws !== socket) return;

    let parsed: unknown;
    try {
      parsed = JSON.parse(data.toString());
    } catch {
      log.warn({ bytes: data.toString().length }, "ha sent malformed JSON, ignoring");
      return;
    }

    // HA may coalesce multiple messages into an array.
    for (const message of Array.isArray(parsed) ? parsed : [parsed]) {
      if (!isIncomingMessage(message)) {
        log.warn("ha sent a message without a type, ignoring");
        continue;
      }
      try {
        handleMessage(ws, message);
      } catch (err) {
        log.error({ err, type: message.type }, "ha failed to handle message");
      }
    }
  };

  const scheduleReconnect = () => {
    attempt += 1;
    const delayMs = backoffDelay(attempt, backoff);
    log.info({ attempt, delayMs }, "ha reconnect scheduled");
    reconnectTimer = setTimeout(open, delayMs);
  };

  const handleClose = (ws: WebSocket, code: number, reason: string) => {
    if (ws !== socket) return;
    socket = undefined;
    stopHeartbeat();
    rejectAllPending(new HomeAssistantNotConnectedError());
    eventHandlers.clear();

    const wasConnected = status === "connected";
    connectedSince = undefined;
    if (wasConnected) notify(disconnectListeners);

    if (status === "auth_failed") return;
    if (status === "stopped") {
      log.info({ target }, "ha connection closed");
      return;
    }

    status = "disconnected";
    if (wasConnected) log.warn({ target, code, reason }, "ha connection lost");
    else log.warn({ target, code, reason }, "ha connection attempt failed");
    scheduleReconnect();
  };

  const open = () => {
    reconnectTimer = undefined;
    if (status === "stopped") return;

    status = "connecting";
    if (attempt === 0) log.info({ target }, "ha connecting");
    else log.info({ target, attempt }, "ha reconnect attempt");

    const ws = new WebSocket(url, { handshakeTimeout: handshakeTimeoutMs });
    socket = ws;
    ws.on("message", (data) => handleRawMessage(ws, data));
    // 'close' always follows 'error', so reconnect logic lives there.
    ws.on("error", (err: NodeJS.ErrnoException) => {
      // Connection-refused arrives as an AggregateError with an empty message but a code.
      if (ws === socket) log.warn({ target, reason: err.message || err.code }, "ha socket error");
    });
    ws.on("close", (code, reason) => handleClose(ws, code, reason.toString()));
  };

  const start = () => {
    if (status !== "idle") return;
    open();
  };

  const stop = async () => {
    status = "stopped";
    clearTimeout(reconnectTimer);
    stopHeartbeat();
    const ws = socket;
    if (!ws || ws.readyState === WebSocket.CLOSED) return;

    await new Promise<void>((resolve) => {
      const force = setTimeout(() => {
        ws.terminate();
        resolve();
      }, STOP_TIMEOUT_MS);
      ws.once("close", () => {
        clearTimeout(force);
        resolve();
      });
      ws.close(1000, "gateway shutting down");
    });
  };

  return {
    start,
    stop,

    /** Sends a command and resolves with HA's `result` payload. Rejects immediately if not connected. */
    sendCommand: <T = unknown>(command: OutgoingCommand) => request<T>(command).result,

    /** Sends a subscribe-style command; `onEvent` receives each event for it. Resolves with the subscription id. */
    subscribe: async (command: OutgoingCommand, onEvent: EventHandler) => {
      const { id, result } = request(command, onEvent);
      await result;
      return id;
    },

    unsubscribe: async (subscriptionId: number) => {
      if (!eventHandlers.delete(subscriptionId)) return;
      await request({ type: "unsubscribe_events", subscription: subscriptionId }).result;
    },

    /** Fires after every successful authentication, including reconnects. */
    onReady: (listener: () => void) => {
      readyListeners.add(listener);
      return () => readyListeners.delete(listener);
    },

    /** Fires when an authenticated connection drops. */
    onDisconnect: (listener: () => void) => {
      disconnectListeners.add(listener);
      return () => disconnectListeners.delete(listener);
    },

    isConnected: () => status === "connected",

    getStatus: () => ({
      status,
      haVersion,
      connectedSince: connectedSince?.toISOString(),
      reconnectAttempt: attempt,
      pendingCommands: pending.size,
    }),
  };
};

export type Connection = ReturnType<typeof createConnection>;
