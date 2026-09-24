import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createActionRunner, InvalidActionParamsError } from "../../home-assistant/actions.js";
import type { CallService } from "../../home-assistant/services.js";
import type { CallServiceParams } from "../../home-assistant/types.js";
import { createCapturingLogger, okResult } from "../../test-support/fakes.js";
import { alexaSay, notifyMaddiesPhone, phoneNotify, phoneSay, speakOn } from "./actions.js";

const setup = (actions: Parameters<typeof createActionRunner>[0]["actions"]) => {
  const calls: CallServiceParams[] = [];
  const callService: CallService = async (params) => {
    calls.push(params);
    return okResult;
  };
  const { logger } = createCapturingLogger();
  return { runner: createActionRunner({ actions, homeAssistant: { callService }, logger }), calls };
};

describe("alexaSay", () => {
  it("announces the app's message on the chosen Echo through notify.alexa_media", async () => {
    const { runner, calls } = setup({ say_upstairs: alexaSay("media_player.upstairs_echo") });

    await runner.run("say_upstairs", { message: "Quest complete" });

    assert.deepEqual(calls, [
      {
        domain: "notify",
        service: "alexa_media",
        data: { target: ["media_player.upstairs_echo"], data: { type: "announce" }, message: "Quest complete" },
      },
    ]);
  });

  it("can speak without the announcement chime", async () => {
    const { runner, calls } = setup({ say: alexaSay("media_player.kitchen_echo", { type: "tts" }) });

    await runner.run("say", { message: "Hi" });

    assert.deepEqual(calls[0]?.data?.data, { type: "tts" });
  });

  it("only lets the app set the message, not which Echo speaks", async () => {
    const { runner, calls } = setup({ say: alexaSay("media_player.upstairs_echo") });

    await assert.rejects(
      runner.run("say", { message: "Hi", target: ["media_player.other_echo"] }),
      (err) => err instanceof InvalidActionParamsError && err.problems.includes('"target" is not an allowed param'),
    );
    await assert.rejects(runner.run("say", { message: 42 }), InvalidActionParamsError);
    assert.equal(calls.length, 0);
  });
});

describe("speakOn", () => {
  it("speaks the app's message on the chosen media player through tts.speak", async () => {
    const { runner, calls } = setup({ say_upstairs: speakOn("media_player.upstairs_speaker") });

    await runner.run("say_upstairs", { message: "Quest complete" });

    assert.deepEqual(calls, [
      {
        domain: "tts",
        service: "speak",
        target: { entity_id: "tts.google_translate_en_com" },
        data: { media_player_entity_id: "media_player.upstairs_speaker", message: "Quest complete" },
      },
    ]);
  });

  it("doesn't let the app choose a different device", async () => {
    const { runner, calls } = setup({ say: speakOn("media_player.upstairs_speaker") });

    await assert.rejects(
      runner.run("say", { message: "Hi", media_player_entity_id: "media_player.shield" }),
      InvalidActionParamsError,
    );
    assert.equal(calls.length, 0);
  });
});

describe("phoneSay", () => {
  it("sends the companion app's TTS notification with the message as tts_text", async () => {
    const { runner, calls } = setup({ say_on_phone: phoneSay("mobile_app_maddie_s_pixel") });

    await runner.run("say_on_phone", { message: "Quest complete" });

    assert.deepEqual(calls, [
      {
        domain: "notify",
        service: "mobile_app_maddie_s_pixel",
        data: { message: "TTS", data: { media_stream: "music_stream", tts_text: "Quest complete" } },
      },
    ]);
  });

  it("keeps the fixed media stream: apps can't switch to the alarm stream", async () => {
    const { runner, calls } = setup({ say_on_phone: phoneSay("mobile_app_maddie_s_pixel") });

    await assert.rejects(
      runner.run("say_on_phone", { message: "Hi", media_stream: "alarm_stream_max" }),
      InvalidActionParamsError,
    );
    assert.equal(calls.length, 0);
  });

  it("lists the param as a plain string to apps", () => {
    const { runner } = setup({ say_on_phone: phoneSay("mobile_app_maddie_s_pixel") });
    assert.deepEqual(runner.list(), [{ name: "say_on_phone", params: { message: "string" } }]);
  });
});

describe("phoneNotify", () => {
  it("sends the app's message to the chosen phone's notify entity", async () => {
    const { runner, calls } = setup({ notify_cams_phone: phoneNotify("notify.cams_iphone", { title: "Cam Quest" }) });

    await runner.run("notify_cams_phone", { message: "Quest complete" });

    assert.deepEqual(calls, [
      {
        domain: "notify",
        service: "send_message",
        target: { entity_id: "notify.cams_iphone" },
        data: { title: "Cam Quest", message: "Quest complete" },
      },
    ]);
  });

  it("doesn't let the app pick a different phone", async () => {
    const { runner, calls } = setup({ notify_cams_phone: phoneNotify("notify.cams_iphone") });

    await assert.rejects(
      runner.run("notify_cams_phone", { message: "Hi", entity_id: "notify.maddie_s_mobile" }),
      InvalidActionParamsError,
    );
    assert.equal(calls.length, 0);
  });

  it("keeps notifyMaddiesPhone's existing defaults", async () => {
    const { runner, calls } = setup({ test_phone_notification: notifyMaddiesPhone });

    await runner.run("test_phone_notification");

    assert.deepEqual(calls[0], {
      domain: "notify",
      service: "send_message",
      target: { entity_id: "notify.maddie_s_mobile" },
      data: { title: "ha-gateway", message: "Test notification from ha-gateway" },
    });
  });
});
