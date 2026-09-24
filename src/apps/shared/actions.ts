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
