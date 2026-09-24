import { createHash, timingSafeEqual } from "node:crypto";
import type { FastifyReply, FastifyRequest } from "fastify";

declare module "fastify" {
  interface FastifyRequest {
    /** Name of the app whose API key authenticated this request. Set by the app auth hook. */
    gatewayApp: string | null;
  }
}

const digest = (value: string) => createHash("sha256").update(value).digest();

/**
 * preHandler hook for app-facing routes. Apps send `Authorization: Bearer <their API key>`,
 * and the key decides which app the request is acting as. Fails closed: with no keys
 * configured, every protected route is unavailable.
 */
export const createAppAuth = (apps: { name: string; apiKey: string | undefined }[]) => {
  const keys = apps.flatMap(({ name, apiKey }) => (apiKey ? [{ name, digest: digest(apiKey) }] : []));

  return async (request: FastifyRequest, reply: FastifyReply) => {
    if (keys.length === 0) {
      return reply.code(503).send({ error: "gateway API is disabled: no app API keys are configured" });
    }
    const [scheme, token] = request.headers.authorization?.split(" ") ?? [];
    if (scheme !== "Bearer" || !token) return reply.code(401).send({ error: "unauthorized" });

    // Compare fixed-length digests against every key so timing doesn't reveal which app matched.
    const presented = digest(token);
    let match: string | undefined;
    for (const key of keys) {
      if (timingSafeEqual(presented, key.digest)) match = key.name;
    }
    if (!match) return reply.code(401).send({ error: "unauthorized" });
    request.gatewayApp = match;
  };
};
