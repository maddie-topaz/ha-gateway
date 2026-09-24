/**
 * End-to-end through the real connection: a local WebSocket server plays Home Assistant,
 * so auth, request/response matching and error translation are all exercised for real.
 */
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { after, before, describe, it } from "node:test";
import { WebSocketServer } from "ws";
import { createCapturingLogger } from "../test-support/fakes.js";
import { createHomeAssistantClient, type HomeAssistantClient } from "./client.js";
import { HomeAssistantCommandError, HomeAssistantInvalidResponseError } from "./types.js";

const TOKEN = "test-token-that-must-never-be-logged";

type Received = { domain?: string; service?: string; target?: unknown; service_data?: unknown };

describe("Home Assistant client service calls (fake HA server)", () => {
  let server: WebSocketServer;
  let client: HomeAssistantClient;
  const received: Received[] = [];
  const { logger, output } = createCapturingLogger();

  before(async () => {
    server = new WebSocketServer({ port: 0, path: "/api/websocket" });
    server.on("connection", (ws) => {
      ws.send(JSON.stringify({ type: "auth_required", ha_version: "2026.9.0" }));
      ws.on("message", (raw) => {
        const msg = JSON.parse(raw.toString()) as { type: string; id: number; access_token?: string } & Received;
        const reply = (body: object) => ws.send(JSON.stringify({ id: msg.id, type: "result", ...body }));

        if (msg.type === "auth") {
          ws.send(JSON.stringify(msg.access_token === TOKEN ? { type: "auth_ok", ha_version: "2026.9.0" } : { type: "auth_invalid" }));
        } else if (msg.type === "subscribe_events") {
          reply({ success: true, result: null });
        } else if (msg.type === "call_service") {
          received.push({ domain: msg.domain, service: msg.service, target: msg.target, service_data: msg.service_data });
          if (msg.service === "explode") {
            reply({ success: false, error: { code: "service_not_found", message: "Service light.explode not found." } });
          } else if (msg.service === "weird") {
            reply({ success: true, result: "not what HA sends" });
          } else {
            reply({ success: true, result: { context: { id: "ctx-1", parent_id: null, user_id: null } } });
          }
        }
      });
    });
    await new Promise((resolve) => server.once("listening", resolve));
    const { port } = server.address() as AddressInfo;

    client = createHomeAssistantClient({ websocketUrl: `ws://127.0.0.1:${port}/api/websocket`, token: TOKEN, logger });
    client.start();
    // Wait until authenticated.
    for (let i = 0; i < 100 && !client.isConnected(); i++) await new Promise((r) => setTimeout(r, 20));
    assert.ok(client.isConnected(), "client should authenticate against the fake HA");
  });

  after(async () => {
    await client.stop();
    await new Promise((resolve) => server.close(resolve));
  });

  it("callService sends the call and resolves with HA's context", async () => {
    const result = await client.callService({
      domain: "light",
      service: "turn_on",
      target: { entity_id: "light.living_room" },
      data: { brightness_pct: 30, rgb_color: [145, 50, 255] },
    });

    assert.equal(result.context.id, "ctx-1");
    assert.deepEqual(received.at(-1), {
      domain: "light",
      service: "turn_on",
      target: { entity_id: "light.living_room" },
      service_data: { brightness_pct: 30, rgb_color: [145, 50, 255] },
    });
  });

  it("helpers go through the same connection", async () => {
    await client.toggle("light.study_lamps");
    assert.deepEqual(received.at(-1), {
      domain: "light",
      service: "toggle",
      target: { entity_id: "light.study_lamps" },
      service_data: undefined,
    });
  });

  it("an HA error result rejects with HomeAssistantCommandError and HA's code", async () => {
    await assert.rejects(
      client.callService({ domain: "light", service: "explode" }),
      (err) => err instanceof HomeAssistantCommandError && err.code === "service_not_found",
    );
  });

  it("a malformed success result rejects with HomeAssistantInvalidResponseError", async () => {
    await assert.rejects(client.callService({ domain: "light", service: "weird" }), HomeAssistantInvalidResponseError);
  });

  it("never logs the HA token", () => {
    assert.ok(output().length > 0, "the client should have logged something");
    assert.ok(!output().includes(TOKEN));
  });
});
