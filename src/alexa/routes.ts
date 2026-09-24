import type { FastifyInstance, FastifyRequest } from "fastify";
import type { EventRouter } from "../routing/event-router.js";
import { handleAlexaRequest, skillIdOf, type AlexaReplies, type AlexaRequestBody } from "./skill.js";
import { AlexaVerificationError, type AlexaVerifier } from "./verify.js";

export type AlexaApp = {
  name: string;
  skillId: string;
  replies: AlexaReplies;
};

type AlexaRoutesOptions = {
  apps: AlexaApp[];
  verifier: AlexaVerifier;
  router: EventRouter;
};

const header = (request: FastifyRequest, name: string) => {
  const value = request.headers[name];
  return Array.isArray(value) ? value[0] : value;
};

/**
 * `POST /<app>`: the endpoint an app's Alexa skill calls. Alexa can't send an app API key, so
 * instead every request must carry Amazon's signature and name the app's own skill ID.
 * A phrase becomes a PHRASE_HEARD event for the app, delivered like any other event.
 */
export const alexaRoutes = async (routes: FastifyInstance, { apps, verifier, router }: AlexaRoutesOptions) => {
  const appsByName = new Map(apps.map((a) => [a.name, a]));

  // Keep the raw bytes: the signature covers the body exactly as Alexa sent it.
  routes.addContentTypeParser("application/json", { parseAs: "buffer" }, (_request, body, done) => done(null, body));

  routes.post<{ Params: { app: string }; Body: Buffer }>("/:app", async (request, reply) => {
    const app = appsByName.get(request.params.app);
    if (!app) return reply.code(404).send({ error: "not found" });

    let body: AlexaRequestBody;
    try {
      await verifier.verifySignature({
        certUrl: header(request, "signaturecertchainurl"),
        signature: header(request, "signature-256"),
        rawBody: Buffer.isBuffer(request.body) ? request.body : Buffer.alloc(0),
      });
      body = JSON.parse(request.body.toString("utf8")) as AlexaRequestBody;
      verifier.verifyTimestamp(body.request?.timestamp);
      if (skillIdOf(body) !== app.skillId) throw new AlexaVerificationError("request is for a different skill");
    } catch (err) {
      if (!(err instanceof AlexaVerificationError || err instanceof SyntaxError)) throw err;
      request.log.warn({ app: app.name, reason: err.message }, "alexa request rejected");
      return reply.code(400).send({ error: "invalid alexa request" });
    }

    return handleAlexaRequest(body, {
      replies: app.replies,
      onPhrase: (phrase) => {
        request.log.info({ app: app.name }, "alexa phrase heard");
        router.route(app.name, {
          type: "PHRASE_HEARD",
          timestamp: body.request?.timestamp ?? new Date().toISOString(),
          data: { phrase, source: "alexa" },
        });
      },
    });
  });
};
