import Fastify, { LogController } from "fastify";
import { InvalidActionParamsError, UnknownActionError, type ActionRunner } from "../home-assistant/actions.js";
import type { HomeAssistantClient } from "../home-assistant/client.js";
import {
  HomeAssistantCommandError,
  HomeAssistantNotConnectedError,
  HomeAssistantTimeoutError,
} from "../home-assistant/types.js";
import type { Logger } from "../logger.js";
import type { EventRouter } from "../routing/event-router.js";
import { createApiKeyAuth } from "./auth.js";

type ServerOptions = {
  logger: Logger;
  homeAssistant: HomeAssistantClient;
  router: EventRouter;
  actions: ActionRunner;
  gatewayApiKey: string | undefined;
};

/** Maps action failures to HTTP responses so apps can tell "HA is down" from "you sent bad params". */
const actionErrorResponse = (err: unknown) => {
  if (err instanceof UnknownActionError) return { status: 404, body: { error: err.message } };
  if (err instanceof InvalidActionParamsError) return { status: 400, body: { error: "invalid params", problems: err.problems } };
  if (err instanceof HomeAssistantNotConnectedError) return { status: 503, body: { error: "Home Assistant is not connected" } };
  if (err instanceof HomeAssistantTimeoutError) return { status: 504, body: { error: "Home Assistant did not respond in time" } };
  if (err instanceof HomeAssistantCommandError) return { status: 502, body: { error: err.message, code: err.code } };
  return undefined;
};

export const createServer = ({ logger, homeAssistant, router, actions, gatewayApiKey }: ServerOptions) => {
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

  // Authenticated app-facing API. Everything in this scope requires GATEWAY_API_KEY.
  app.register(
    async (v1) => {
      v1.addHook("preHandler", createApiKeyAuth(gatewayApiKey));

      v1.get("/status", async () => ({
        homeAssistant: homeAssistant.getStatus(),
        consumers: router.consumers(),
        uptimeSeconds: Math.round(process.uptime()),
      }));

      v1.get("/actions", async () => ({ actions: actions.list() }));

      v1.post<{ Params: { name: string }; Body: { params?: unknown } | undefined }>(
        "/actions/:name",
        async (request, reply) => {
          const { name } = request.params;
          try {
            await actions.run(name, request.body?.params);
            return { ok: true, action: name };
          } catch (err) {
            const response = actionErrorResponse(err);
            if (!response) throw err;
            return reply.code(response.status).send(response.body);
          }
        },
      );
    },
    { prefix: "/v1" },
  );

  return app;
};
