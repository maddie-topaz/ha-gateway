import { existsSync } from "node:fs";

const LOG_LEVELS = ["fatal", "error", "warn", "info", "debug", "trace", "silent"] as const;
type LogLevel = (typeof LOG_LEVELS)[number];

const MIN_API_KEY_LENGTH = 32;

export type Config = {
  port: number;
  host: string;
  logLevel: LogLevel;
  homeAssistant: {
    /** Full WebSocket URL, e.g. wss://ha.example.com/api/websocket */
    websocketUrl: string;
    token: string;
  };
  /** Shared secret for authenticated app-facing routes. Undefined means those routes are disabled. */
  gatewayApiKey: string | undefined;
};

export class ConfigError extends Error {
  constructor(readonly problems: string[]) {
    super(`Invalid configuration:\n  - ${problems.join("\n  - ")}`);
    this.name = "ConfigError";
  }
}

/**
 * Accepts either the HA base URL (http[s]://host:8123) or the WebSocket URL
 * (ws[s]://host:8123/api/websocket) and returns the WebSocket URL.
 */
const toWebSocketUrl = (raw: string): string => {
  const url = new URL(raw);
  const protocols: Record<string, string> = { "http:": "ws:", "https:": "wss:", "ws:": "ws:", "wss:": "wss:" };
  const protocol = protocols[url.protocol];
  if (!protocol) throw new Error(`unsupported protocol "${url.protocol}"`);
  url.protocol = protocol;
  if (!url.pathname.endsWith("/api/websocket")) {
    url.pathname = `${url.pathname.replace(/\/+$/, "")}/api/websocket`;
  }
  url.search = "";
  url.hash = "";
  return url.toString();
};

/** Loads a local .env for development. Existing environment variables (e.g. Railway's) take precedence. */
const loadDotEnv = () => {
  if (existsSync(".env")) process.loadEnvFile(".env");
};

export const loadConfig = (env: NodeJS.ProcessEnv = process.env): Config => {
  loadDotEnv();

  const problems: string[] = [];
  const read = (name: string) => env[name]?.trim() || undefined;

  const haUrl = read("HA_URL");
  const haToken = read("HA_TOKEN");
  const apiKey = read("GATEWAY_API_KEY");
  const rawPort = read("PORT") ?? "3000";
  const rawLogLevel = read("LOG_LEVEL") ?? "info";

  let websocketUrl = "";
  if (!haUrl) {
    problems.push("HA_URL is required");
  } else {
    try {
      websocketUrl = toWebSocketUrl(haUrl);
    } catch (err) {
      problems.push(`HA_URL is not a valid URL (${(err as Error).message})`);
    }
  }

  if (!haToken) problems.push("HA_TOKEN is required");
  else if (/\s/.test(haToken)) problems.push("HA_TOKEN must not contain whitespace");

  const port = Number(rawPort);
  if (!Number.isInteger(port) || port < 1 || port > 65535) problems.push("PORT must be an integer between 1 and 65535");

  if (!LOG_LEVELS.includes(rawLogLevel as LogLevel)) problems.push(`LOG_LEVEL must be one of ${LOG_LEVELS.join(", ")}`);

  if (apiKey !== undefined && apiKey.length < MIN_API_KEY_LENGTH) {
    problems.push(`GATEWAY_API_KEY must be at least ${MIN_API_KEY_LENGTH} characters when set`);
  }

  if (problems.length > 0) throw new ConfigError(problems);

  return {
    port,
    host: read("HOST") ?? "0.0.0.0",
    logLevel: rawLogLevel as LogLevel,
    homeAssistant: { websocketUrl, token: haToken! },
    gatewayApiKey: apiKey,
  };
};
