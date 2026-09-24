import { createServer } from "./api/server.js";
import { ConfigError, loadConfig, type Config } from "./config/env.js";
import { actions as actionDefinitions } from "./config/actions.js";
import { eventRules } from "./config/events.js";
import { createActionRunner } from "./home-assistant/actions.js";
import { createHomeAssistantClient } from "./home-assistant/client.js";
import { createStateChangeNormalizer } from "./home-assistant/events.js";
import { createLogger } from "./logger.js";
import { createEventRouter, createLogConsumer } from "./routing/event-router.js";
import { createWebhookConsumer } from "./routing/webhook.js";

const SHUTDOWN_TIMEOUT_MS = 10_000;

const readConfig = (): Config => {
  try {
    return loadConfig();
  } catch (err) {
    // Fail closed: never start without valid config. Logger isn't set up yet, so write directly.
    console.error(err instanceof ConfigError ? err.message : err);
    process.exit(1);
  }
};

const main = async () => {
  const config = readConfig();
  const logger = createLogger(config.logLevel);
  const haUrl = new URL(config.homeAssistant.websocketUrl);

  logger.info(
    { node: process.version, haHost: haUrl.host, apiEnabled: config.gatewayApiKey !== undefined },
    "service starting",
  );
  if (haUrl.protocol === "ws:" && !["localhost", "127.0.0.1", "::1"].includes(haUrl.hostname)) {
    logger.warn({ haHost: haUrl.host }, "HA_URL is not using TLS; the access token is sent unencrypted");
  }

  const homeAssistant = createHomeAssistantClient({
    websocketUrl: config.homeAssistant.websocketUrl,
    token: config.homeAssistant.token,
    logger,
  });

  const router = createEventRouter({ logger });
  router.register(createLogConsumer(logger));
  for (const webhook of config.webhooks) {
    router.register(createWebhookConsumer({ ...webhook, logger }));
  }
  for (const { name, urlEnv } of config.disabledWebhooks) {
    logger.warn({ webhook: name, urlEnv }, "webhook disabled: URL env var not set");
  }

  const normalize = createStateChangeNormalizer(eventRules);
  void homeAssistant.onStateChanged((event) => {
    logger.debug({ event }, "ha state_changed received");
    const normalized = normalize(event);
    if (normalized) router.route(normalized);
  });

  const actions = createActionRunner({ actions: actionDefinitions, homeAssistant, logger });
  if (actions.count() > 0 && !config.gatewayApiKey) {
    logger.warn({ actions: actions.count() }, "actions are configured but GATEWAY_API_KEY is not set, so apps can't call them");
  }

  const server = createServer({ logger, homeAssistant, router, actions, gatewayApiKey: config.gatewayApiKey });

  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal }, "shutdown started");

    setTimeout(() => {
      logger.error("shutdown timed out, forcing exit");
      process.exit(1);
    }, SHUTDOWN_TIMEOUT_MS).unref();

    const results = await Promise.allSettled([server.close(), homeAssistant.stop()]);
    const failed = results.filter((r) => r.status === "rejected");
    if (failed.length > 0) logger.error({ errors: failed.map((r) => String(r.reason)) }, "shutdown completed with errors");
    else logger.info("shutdown complete");
    process.exit(failed.length > 0 ? 1 : 0);
  };

  process.once("SIGTERM", () => void shutdown("SIGTERM"));
  process.once("SIGINT", () => void shutdown("SIGINT"));

  // Log and carry on for stray rejections; the HA connection manages its own recovery.
  process.on("unhandledRejection", (reason) => logger.error({ reason: String(reason) }, "unhandled promise rejection"));
  // State is unknown after an uncaught exception: exit and let Railway restart us.
  process.on("uncaughtException", (err) => {
    logger.fatal({ err }, "uncaught exception");
    process.exit(1);
  });

  await server.listen({ port: config.port, host: config.host });
  logger.info({ port: config.port, host: config.host }, "http server listening");

  homeAssistant.start();
};

main().catch((err) => {
  console.error("fatal startup error", err);
  process.exit(1);
});
