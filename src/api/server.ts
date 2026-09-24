import Fastify, { LogController } from "fastify";
import type { HomeAssistantClient } from "../home-assistant/client.js";
import type { Logger } from "../logger.js";
import type { EventRouter } from "../routing/event-router.js";
import { createApiKeyAuth } from "./auth.js";

type ServerOptions = {
  logger: Logger;
  homeAssistant: HomeAssistantClient;
  router: EventRouter;
  gatewayApiKey: string | undefined;
};

export const createServer = ({ logger, homeAssistant, router, gatewayApiKey }: ServerOptions) => {
  const app = Fastify({
    loggerInstance: logger.child({ component: "http" }),
    // Health checks would drown out everything else.
    logController: new LogController({ disableRequestLogging: (request) => request.url === "/health" }),
    trustProxy: true,
    bodyLimit: 64 * 1024,
  });

  /**
   * Public liveness check for Railway. Always 200 while the process is serving: a Home Assistant
   * outage is reported as "degraded" rather than failing, so HA downtime doesn't block deploys
   * or trigger restarts that wouldn't help.
   */
  app.get("/health", async () => {
    const connected = homeAssistant.isConnected();
    return {
      status: connected ? "ok" : "degraded",
      homeAssistant: connected ? "connected" : homeAssistant.getStatus().status,
      uptimeSeconds: Math.round(process.uptime()),
    };
  });

  // Authenticated app-facing API. Add command endpoints (e.g. POST /v1/services/:domain/:service)
  // inside this scope so they inherit auth. Prefer allowlisting specific services over exposing
  // arbitrary HA service calls.
  app.register(
    async (v1) => {
      v1.addHook("preHandler", createApiKeyAuth(gatewayApiKey));

      v1.get("/status", async () => ({
        homeAssistant: homeAssistant.getStatus(),
        consumers: router.consumers(),
        uptimeSeconds: Math.round(process.uptime()),
      }));
    },
    { prefix: "/v1" },
  );

  return app;
};
