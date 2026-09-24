import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createCapturingLogger, okResult } from "../test-support/fakes.js";
import { createActionRunner, InvalidActionParamsError, UnknownActionError, type ActionDefinition } from "./actions.js";
import type { CallService } from "./services.js";
import type { CallServiceParams } from "./types.js";

const setup = (actions: Record<string, ActionDefinition>) => {
  const calls: CallServiceParams[] = [];
  const callService: CallService = async (params) => {
    calls.push(params);
    return okResult;
  };
  const { logger } = createCapturingLogger();
  return { runner: createActionRunner({ actions, homeAssistant: { callService }, logger }), calls };
};

const nested: ActionDefinition = {
  domain: "notify",
  service: "send",
  data: { message: "fixed", data: { stream: "music", tts_text: "default text" } },
  params: {
    text: { type: "string", path: ["data", "tts_text"] },
    title: "string",
    level: { type: "number", path: ["data", "extra", "level"] },
  },
};

describe("action runner", () => {
  describe("param paths", () => {
    it("puts bare-typed params at the top level and path params where their path says", async () => {
      const { runner, calls } = setup({ nested });

      await runner.run("nested", { text: "hello", title: "Hi", level: 3 });

      assert.deepEqual(calls[0]?.data, {
        message: "fixed",
        title: "Hi",
        data: { stream: "music", tts_text: "hello", extra: { level: 3 } },
      });
    });

    it("uses the fixed data as defaults when params are left out", async () => {
      const { runner, calls } = setup({ nested });

      await runner.run("nested");

      assert.deepEqual(calls[0]?.data, nested.data);
    });

    it("never changes the action's own data between calls", async () => {
      const { runner, calls } = setup({ nested });

      await runner.run("nested", { text: "first" });
      await runner.run("nested", {});

      assert.deepEqual(nested.data, { message: "fixed", data: { stream: "music", tts_text: "default text" } });
      assert.deepEqual(calls[1]?.data, nested.data);
    });

    it("type-checks path params", async () => {
      const { runner } = setup({ nested });

      await assert.rejects(
        runner.run("nested", { text: 42, level: "high" }),
        (err) =>
          err instanceof InvalidActionParamsError &&
          err.problems.includes('"text" must be a string') &&
          err.problems.includes('"level" must be a number'),
      );
    });
  });

  describe("config checks at startup", () => {
    it("rejects a path through a fixed value that isn't an object", () => {
      assert.throws(
        () =>
          setup({
            bad: { domain: "notify", service: "send", data: { message: "TTS" }, params: { x: { type: "string", path: ["message", "x"] } } },
          }),
        /runs into a fixed value/,
      );
    });

    it("rejects paths that could reach the object prototype", () => {
      assert.throws(
        () => setup({ bad: { domain: "notify", service: "send", params: { x: { type: "string", path: ["__proto__", "x"] } } } }),
        /invalid path/,
      );
    });
  });

  it("rejects unknown actions, including names on Object.prototype", async () => {
    const { runner } = setup({ nested });
    await assert.rejects(runner.run("constructor"), UnknownActionError);
    await assert.rejects(runner.run("missing"), UnknownActionError);
  });
});
