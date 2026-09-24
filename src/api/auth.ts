import { createHash, timingSafeEqual } from "node:crypto";
import type { FastifyReply, FastifyRequest } from "fastify";

const digest = (value: string) => createHash("sha256").update(value).digest();

/**
 * preHandler hook for app-facing routes. Apps authenticate with `Authorization: Bearer <GATEWAY_API_KEY>`.
 * Fails closed: if no key is configured, every protected route is unavailable.
 *
 * This is the one place to evolve app auth (per-app keys, scopes, JWTs) later.
 */
export const createApiKeyAuth = (apiKey: string | undefined) => {
  const expected = apiKey ? digest(apiKey) : undefined;

  return async (request: FastifyRequest, reply: FastifyReply) => {
    if (!expected) {
      return reply.code(503).send({ error: "gateway API is disabled: GATEWAY_API_KEY is not configured" });
    }
    const [scheme, token] = request.headers.authorization?.split(" ") ?? [];
    // Compare fixed-length digests so the check is constant-time regardless of input length.
    if (scheme !== "Bearer" || !token || !timingSafeEqual(digest(token), expected)) {
      return reply.code(401).send({ error: "unauthorized" });
    }
  };
};
