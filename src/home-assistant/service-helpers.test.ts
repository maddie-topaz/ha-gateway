import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { okResult } from "../test-support/fakes.js";
import { createServiceHelpers } from "./service-helpers.js";
import type { CallService } from "./services.js";
import { HomeAssistantCommandError, HomeAssistantInvalidRequestError, type CallServiceParams } from "./types.js";

/** A stand-in callService that records its arguments, proving helpers delegate to it. */
const setup = (callService?: CallService) => {
  const calls: CallServiceParams[] = [];
  const recording: CallService = async (params) => {
    calls.push(params);
    return callService ? callService(params) : okResult;
  };
  return { helpers: createServiceHelpers(recording), calls };
};

describe("service helpers", () => {
  it("turnOn calls <domain>.turn_on on the entity, with optional data", async () => {
    const { helpers, calls } = setup();

    await helpers.turnOn("light.living_room", { brightness_pct: 30, rgb_color: [145, 50, 255] });
    await helpers.turnOn("switch.camputer");

    assert.deepEqual(calls, [
      {
        domain: "light",
        service: "turn_on",
        target: { entity_id: "light.living_room" },
        data: { brightness_pct: 30, rgb_color: [145, 50, 255] },
      },
      { domain: "switch", service: "turn_on", target: { entity_id: "switch.camputer" } },
    ]);
  });

  it("turnOff and toggle call the matching service on the entity's own domain", async () => {
    const { helpers, calls } = setup();

    await helpers.turnOff("fan.skyfan_dc");
    await helpers.toggle("light.study_lamps");

    assert.deepEqual(calls, [
      { domain: "fan", service: "turn_off", target: { entity_id: "fan.skyfan_dc" } },
      { domain: "light", service: "toggle", target: { entity_id: "light.study_lamps" } },
    ]);
  });

  it("returns callService's result", async () => {
    const { helpers } = setup();
    assert.deepEqual(await helpers.toggle("light.study_lamps"), okResult);
  });

  it("passes callService's errors through", async () => {
    const haError = new HomeAssistantCommandError("not_found", "Entity not found");
    const { helpers } = setup(async () => {
      throw haError;
    });

    await assert.rejects(helpers.turnOn("light.missing"), (err) => err === haError);
  });

  for (const entityId of ["lounge", "light.", ".lounge", "Light.Lounge", "light.lounge.extra"]) {
    it(`rejects the malformed entity ID "${entityId}" without calling HA`, async () => {
      const { helpers, calls } = setup();

      await assert.rejects(helpers.turnOn(entityId), HomeAssistantInvalidRequestError);
      assert.equal(calls.length, 0);
    });
  }
});
