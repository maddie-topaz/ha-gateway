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
import type { ActionDefinition, ParamSpec } from "../../home-assistant/actions.js";
import { domainOf } from "../../home-assistant/service-helpers.js";
import type { ServiceData } from "../../home-assistant/types.js";

/**
 * Sends a notification to one phone, through its notify entity (works for iPhone and Android).
 * Apps pick the phone: `actions: { notify_cams_phone: phoneNotify("notify.cams_iphone") }`.
 * The phone is fixed per app; the app can set `title` and `message`, and `defaults` fills in either.
 *
 * On an iPhone with Announce Notifications turned on for the Home Assistant app, Siri reads
 * these out loud through AirPods or CarPlay. That's the closest iPhones get to phoneSay.
 */
export const phoneNotify = (
  notifyEntityId: string,
  defaults: { title?: string; message?: string } = {},
): ActionDefinition => ({
  domain: "notify",
  service: "send_message",
  target: { entity_id: notifyEntityId },
  data: { title: "ha-gateway", ...defaults },
  params: { title: "string", message: "string" },
});

/** Notification to Maddie's Pixel only. */
export const notifyMaddiesPhone = phoneNotify("notify.maddie_s_mobile", {
  message: "Test notification from ha-gateway",
});

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

// Domains and entity names that secure the house. On/off actions refuse them outright, so a
// typo or copy-paste can't hand an app the alarm, a lock, a siren or the garage door.
const BLOCKED_DOMAINS = new Set(["lock", "alarm_control_panel", "siren", "cover"]);
const BLOCKED_NAME = /alarm|siren|lock|garage|motion_detection/;

/** Checks one or more entities share a domain and aren't security devices, and returns the domain. */
const onOffDomain = (entityIds: string | readonly string[]) => {
  const ids = typeof entityIds === "string" ? [entityIds] : entityIds;
  if (ids.length === 0) throw new Error("On/off actions need at least one entity");

  const domains = new Set(ids.map(domainOf));
  if (domains.size > 1) throw new Error(`On/off action mixes domains (${[...domains].join(", ")}): use one action per domain`);

  for (const id of ids) {
    const [domain = "", name = ""] = id.split(".");
    if (BLOCKED_DOMAINS.has(domain) || BLOCKED_NAME.test(name)) {
      throw new Error(`${id} looks like a security device, so it can't be used in an on/off action`);
    }
  }
  return [...domains][0]!;
};

const onOffAction = (service: string, entityIds: string | readonly string[], extra: Partial<ActionDefinition> = {}) => ({
  domain: onOffDomain(entityIds),
  service,
  target: { entity_id: entityIds },
  ...extra,
});

/**
 * Turns one or more entities on, e.g. `turnOnAction("light.upstairs_lamp")`. Several entities must
 * share a domain: `turnOnAction(["light.lamp_1", "light.lamp_2"])`.
 * - `data`: fixed values, like `{ brightness_pct: 80 }`.
 * - `params`: values the app may pass, like `{ brightness_pct: "number" }`. They override `data`.
 * Refuses locks, the alarm, sirens, covers and the garage door (checked at startup).
 */
export const turnOnAction = (
  entityIds: string | readonly string[],
  { data, params }: { data?: ServiceData; params?: Record<string, ParamSpec> } = {},
): ActionDefinition => onOffAction("turn_on", entityIds, { ...(data && { data }), ...(params && { params }) });

/** Turns one or more entities off. Same rules as turnOnAction. */
export const turnOffAction = (entityIds: string | readonly string[]): ActionDefinition => onOffAction("turn_off", entityIds);

/** Toggles one or more entities. Same rules as turnOnAction. */
export const toggleAction = (entityIds: string | readonly string[]): ActionDefinition => onOffAction("toggle", entityIds);
