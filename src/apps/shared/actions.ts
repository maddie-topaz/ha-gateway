/**
 * Reusable actions. Apps include them under whatever name suits them, e.g.
 * `actions: { test_phone_notification: notifyMaddiesPhone }`.
 *
 * Each action is a fixed HA service call:
 * - `domain` + `service`: the HA service, e.g. light.turn_on. Try it first in HA under
 *   Developer tools → Actions.
 * - `target`: which entities it affects. Fixed: apps can't change it.
 * - `data`: fixed service data. Params with the same key override it, so it doubles as defaults.
 * - `params`: values the app may pass, with their type ("string", "number" or "boolean").
 *
 * Never add actions for locks, the alarm, sirens, the garage door or camera motion detection.
 */
import type { ActionDefinition } from "../../home-assistant/actions.js";

/** Notification to Maddie's Pixel only. */
export const notifyMaddiesPhone: ActionDefinition = {
  domain: "notify",
  service: "send_message",
  target: { entity_id: "notify.maddie_s_mobile" },
  data: { title: "ha-gateway", message: "Test notification from ha-gateway" },
  params: { title: "string", message: "string" },
};

/**
 * Makes an Echo say whatever message the app sends. Apps pick the Echo:
 * `actions: { say_upstairs: alexaSay("media_player.upstairs_echo") }`.
 * The Echo is fixed per app; the app can only supply `message`.
 *
 * `announce` plays Alexa's chime first; `tts` just speaks.
 *
 * Needs the Alexa Media Player integration (HACS), which isn't installed yet. Until it is,
 * HA answers "service not found" (a 502 to the app), so only give this to an app after installing.
 */
export const alexaSay = (
  echoEntityId: string,
  { type = "announce" }: { type?: "announce" | "tts" } = {},
): ActionDefinition => ({
  domain: "notify",
  service: "alexa_media",
  data: { target: [echoEntityId], data: { type } },
  params: { message: "string" },
});

/**
 * Makes a speaker, TV or other media player say the app's message using HA's text-to-speech.
 * Apps pick the device: `actions: { say_upstairs: speakOn("media_player.upstairs_speaker") }`.
 * The device is fixed per app; the app can only supply `message`.
 *
 * Works with media players that can play audio. Checked so far (2026-09-24): upstairs_speaker,
 * shield, shield_2, downstairs and coreelec report they can; test before relying on one.
 */
export const speakOn = (
  mediaPlayerEntityId: string,
  { ttsEntityId = "tts.google_translate_en_com" }: { ttsEntityId?: string } = {},
): ActionDefinition => ({
  domain: "tts",
  service: "speak",
  target: { entity_id: ttsEntityId },
  data: { media_player_entity_id: mediaPlayerEntityId },
  params: { message: "string" },
});

/**
 * Makes an Android phone read the app's message out loud, using the Home Assistant
 * companion app's TTS notification. Apps pick the phone by its notify service:
 * `actions: { say_on_maddies_phone: phoneSay("mobile_app_maddie_s_pixel") }`.
 *
 * Android only (iPhones can't do this). Plays on the media volume, so it stays quiet when the
 * phone's media volume is down; apps can't switch it to the alarm stream that ignores silent mode.
 */
export const phoneSay = (notifyService: string): ActionDefinition => ({
  domain: "notify",
  service: notifyService,
  // "TTS" tells the companion app to speak data.tts_text instead of showing a notification.
  data: { message: "TTS", data: { media_stream: "music_stream" } },
  params: { message: { type: "string", path: ["data", "tts_text"] } },
});
