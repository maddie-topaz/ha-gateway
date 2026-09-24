import { existsSync } from "node:fs";
import { apps } from "../apps/index.js";
import type { AppDefinition } from "../apps/types.js";

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
  /** Apps from src/apps/ with their secrets resolved from env vars. */
  apps: ResolvedApp[];
  /** Non-fatal config issues to log at startup. */
  warnings: string[];
};

export type ResolvedApp = {
  definition: AppDefinition;
  /** Undefined means the app can't authenticate, so it can't call actions. */
  apiKey: string | undefined;
  /** Undefined means the app's events are only logged. */
  webhook: { url: string; secret: string | undefined } | undefined;
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

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

const APP_NAME = /^[a-z0-9-]+$/;

const resolveWebhookUrl = (urlEnv: string, url: string, problems: string[]) => {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    problems.push(`${urlEnv} is not a valid URL`);
    return undefined;
  }
  if (parsed.protocol !== "https:" && !(parsed.protocol === "http:" && LOCAL_HOSTS.has(parsed.hostname))) {
    problems.push(`${urlEnv} must use https (http is only allowed for localhost)`);
    return undefined;
  }
  return url;
};

const resolveApps = (read: (name: string) => string | undefined, problems: string[], warnings: string[]) => {
  const names = new Set<string>();
  const keyOwners = new Map<string, string>();

  return apps.map((definition): ResolvedApp => {
    const { name, apiKeyEnv, webhook } = definition;
    if (!APP_NAME.test(name)) problems.push(`App name "${name}" must be lowercase letters, numbers and dashes`);
    if (names.has(name)) problems.push(`Two apps are named "${name}"`);
    names.add(name);

    const apiKey = read(apiKeyEnv);
    if (apiKey === undefined) {
      if (Object.keys(definition.actions ?? {}).length > 0) {
        warnings.push(`${name}: ${apiKeyEnv} is not set, so ${name} can't call its actions`);
      }
    } else if (apiKey.length < MIN_API_KEY_LENGTH) {
      problems.push(`${apiKeyEnv} must be at least ${MIN_API_KEY_LENGTH} characters`);
    } else if (keyOwners.has(apiKey)) {
      // The key is how the gateway tells apps apart, so it must be unique.
      problems.push(`${apiKeyEnv} is the same key as ${keyOwners.get(apiKey)}'s; every app needs its own key`);
    } else {
      keyOwners.set(apiKey, name);
    }

    let resolvedWebhook: ResolvedApp["webhook"];
    if (webhook) {
      const url = read(webhook.urlEnv);
      if (!url) warnings.push(`${name}: ${webhook.urlEnv} is not set, so ${name}'s events are only logged`);
      else {
        const valid = resolveWebhookUrl(webhook.urlEnv, url, problems);
        if (valid) resolvedWebhook = { url: valid, secret: webhook.secretEnv ? read(webhook.secretEnv) : undefined };
      }
    }

    return { definition, apiKey, webhook: resolvedWebhook };
  });
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

  const warnings: string[] = [];
  if (read("GATEWAY_API_KEY")) {
    warnings.push("GATEWAY_API_KEY is no longer used: each app now has its own key (see src/apps/). You can delete it");
  }
  const resolvedApps = resolveApps(read, problems, warnings);

  if (problems.length > 0) throw new ConfigError(problems);

  return {
    port,
    host: read("HOST") ?? "0.0.0.0",
    logLevel: rawLogLevel as LogLevel,
    homeAssistant: { websocketUrl, token: haToken! },
    apps: resolvedApps,
    warnings,
  };
};
