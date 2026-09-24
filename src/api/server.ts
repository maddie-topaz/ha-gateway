import Fastify, { LogController, type FastifyRequest } from "fastify";
import { InvalidActionParamsError, UnknownActionError, type ActionRunner } from "../home-assistant/actions.js";
import { alexaRoutes, type AlexaApp } from "../alexa/routes.js";
import type { AlexaVerifier } from "../alexa/verify.js";
import type { HomeAssistantClient } from "../home-assistant/client.js";
import {
  HomeAssistantCommandError,
  HomeAssistantError,
  HomeAssistantInvalidRequestError,
  HomeAssistantNotConnectedError,
  HomeAssistantTimeoutError,
} from "../home-assistant/types.js";
import type { Logger } from "../logger.js";
import type { EventRouter } from "../routing/event-router.js";
import { createAppAuth } from "./auth.js";

type ServerApp = {
  name: string;
  apiKey: string | undefined;
  actions: ActionRunner;
};

type ServerOptions = {
  logger: Logger;
  homeAssistant: HomeAssistantClient;
  router: EventRouter;
  apps: ServerApp[];
  /** Apps with an Alexa skill, and how to check requests really come from Alexa. */
  alexa: { apps: AlexaApp[]; verifier: AlexaVerifier };
};

/** Maps action failures to HTTP responses so apps can tell "HA is down" from "you sent bad params". */
const actionErrorResponse = (err: unknown) => {
  if (err instanceof UnknownActionError) return { status: 404, body: { error: err.message } };
  if (err instanceof InvalidActionParamsError) return { status: 400, body: { error: "invalid params", problems: err.problems } };
  if (err instanceof HomeAssistantNotConnectedError) return { status: 503, body: { error: "Home Assistant is not connected" } };
  if (err instanceof HomeAssistantTimeoutError) return { status: 504, body: { error: "Home Assistant did not respond in time" } };
  if (err instanceof HomeAssistantCommandError) return { status: 502, body: { error: err.message, code: err.code } };
  if (err instanceof HomeAssistantInvalidRequestError) return { status: 400, body: { error: err.message } };
  // Invalid responses and anything else HA-related.
  if (err instanceof HomeAssistantError) return { status: 502, body: { error: err.message } };
  return undefined;
};

export const createServer = ({ logger, homeAssistant, router, apps, alexa }: ServerOptions) => {
  const appsByName = new Map(apps.map((a) => [a.name, a]));

  const app = Fastify({
    loggerInstance: logger.child({ component: "http" }),
    // Health checks would drown out everything else.
    logController: new LogController({ disableRequestLogging: (request) => request.url === "/health" }),
    trustProxy: true,
    bodyLimit: 64 * 1024,
  });
  app.decorateRequest("gatewayApp", null);

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

  // Alexa skill endpoints. Outside the app auth hook: Amazon's signature stands in for the API key.
  app.register(alexaRoutes, { prefix: "/v1/alexa", apps: alexa.apps, verifier: alexa.verifier, router });

  // Authenticated app-facing API. Every route here requires an app's API key, and only
  // ever acts as (or shows) the app that key belongs to.
  app.register(
    async (v1) => {
      v1.addHook("preHandler", createAppAuth(apps));

      // The auth hook guarantees gatewayApp is a known app name.
      const callingApp = (request: FastifyRequest) => appsByName.get(request.gatewayApp!)!;

      v1.get("/status", async (request) => ({
        app: request.gatewayApp,
        homeAssistant: homeAssistant.getStatus(),
        consumers: router.consumers(),
        uptimeSeconds: Math.round(process.uptime()),
      }));

      v1.get("/actions", async (request) => ({ app: request.gatewayApp, actions: callingApp(request).actions.list() }));

      v1.post<{ Params: { name: string }; Body: { params?: unknown } | undefined }>(
        "/actions/:name",
        async (request, reply) => {
          const { name } = request.params;
          try {
            await callingApp(request).actions.run(name, request.body?.params);
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
