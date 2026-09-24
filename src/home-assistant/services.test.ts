import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createCapturingLogger, createFakeTransport, okResult } from "../test-support/fakes.js";
import { createServiceCaller } from "./services.js";
import {
  HomeAssistantCommandError,
  HomeAssistantError,
  HomeAssistantInvalidRequestError,
  HomeAssistantInvalidResponseError,
  HomeAssistantNotConnectedError,
  HomeAssistantTimeoutError,
} from "./types.js";

const setup = (respond: Parameters<typeof createFakeTransport>[0]) => {
  const { logger, output, entries } = createCapturingLogger();
  const { transport, sent } = createFakeTransport(respond);
  return { callService: createServiceCaller({ transport, logger }), sent, output, entries };
};

describe("callService", () => {
  describe("successful calls", () => {
    it("sends a call_service command with target and data and returns HA's result", async () => {
      const { callService, sent } = setup(() => okResult);

      const result = await callService({
        domain: "light",
        service: "turn_on",
        target: { entity_id: "light.living_room" },
        data: { brightness_pct: 30, rgb_color: [145, 50, 255] },
      });

      assert.deepEqual(result, okResult);
      assert.deepEqual(sent, [
        {
          type: "call_service",
          domain: "light",
          service: "turn_on",
          target: { entity_id: "light.living_room" },
          service_data: { brightness_pct: 30, rgb_color: [145, 50, 255] },
        },
      ]);
    });

    it("leaves out target and service_data when they aren't given", async () => {
      const { callService, sent } = setup(() => okResult);

      await callService({ domain: "script", service: "goodnight" });

      assert.deepEqual(sent, [{ type: "call_service", domain: "script", service: "goodnight" }]);
    });

    it("asks for and returns response data when returnResponse is set", async () => {
      const { callService, sent } = setup(() => ({ ...okResult, response: { forecast: [] } }));

      const result = await callService({ domain: "weather", service: "get_forecasts", returnResponse: true });

      assert.equal(sent[0]?.return_response, true);
      assert.deepEqual(result.response, { forecast: [] });
    });
  });

  describe("invalid responses", () => {
    for (const [label, response] of [
      ["null", null],
      ["a non-object", "ok"],
      ["an object without a context", { success: true }],
      ["a context without an id", { context: {} }],
    ] as const) {
      it(`rejects with HomeAssistantInvalidResponseError when HA returns ${label}`, async () => {
        const { callService } = setup(() => response);

        await assert.rejects(
          callService({ domain: "light", service: "turn_on" }),
          (err) => err instanceof HomeAssistantInvalidResponseError && err.message.includes("light.turn_on"),
        );
      });
    }
  });

  describe("HA errors", () => {
    it("passes HA's error through with its code, and logs it", async () => {
      const { callService, entries } = setup(() => {
        throw new HomeAssistantCommandError("service_not_found", "Service light.fly not found.");
      });

      await assert.rejects(
        callService({ domain: "light", service: "fly", target: { entity_id: "light.lounge" } }),
        (err) =>
          err instanceof HomeAssistantCommandError &&
          err.code === "service_not_found" &&
          err.message === "Service light.fly not found.",
      );

      const failure = entries().find((e) => e.msg === "ha service call failed");
      assert.equal(failure?.service, "light.fly");
      assert.equal(failure?.code, "service_not_found");
      assert.deepEqual(failure?.target, { entity_id: "light.lounge" });
    });

    it("passes not-connected and timeout errors through unchanged", async () => {
      for (const error of [new HomeAssistantNotConnectedError(), new HomeAssistantTimeoutError("call_service", 10_000)]) {
        const { callService } = setup(() => {
          throw error;
        });
        await assert.rejects(callService({ domain: "light", service: "turn_on" }), (err) => err === error);
      }
    });

    it("wraps unexpected errors in HomeAssistantError, keeping the original as the cause", async () => {
      const socketError = new Error("socket hang up");
      const { callService } = setup(() => {
        throw socketError;
      });

      await assert.rejects(
        callService({ domain: "light", service: "turn_on" }),
        (err) =>
          err instanceof HomeAssistantError &&
          err.message === "light.turn_on failed: socket hang up" &&
          err.cause === socketError,
      );
    });
  });

  describe("request validation", () => {
    const malformed: [domain: string, service: string][] = [
      ["Light", "turn_on"],
      ["light", "turn on"],
      ["light", ""],
      ["light/../x", "turn_on"],
    ];
    for (const [domain, service] of malformed) {
      it(`rejects "${domain}.${service}" without contacting HA`, async () => {
        const { callService, sent } = setup(() => okResult);

        await assert.rejects(callService({ domain, service }), HomeAssistantInvalidRequestError);
        assert.equal(sent.length, 0);
      });
    }
  });

  describe("logging", () => {
    it("logs data keys but never data values", async () => {
      const { callService, output, entries } = setup(() => okResult);

      await callService({
        domain: "notify",
        service: "send_message",
        target: { entity_id: "notify.phone" },
        data: { message: "a private message" },
      });

      assert.ok(!output().includes("a private message"));
      const call = entries().find((e) => e.msg === "ha service called");
      assert.deepEqual(call?.dataKeys, ["message"]);
      assert.equal(call?.service, "notify.send_message");
    });
  });
});
