/**
 * ─────────────────────────────────────────────────────────────────────────────
 *  ACTIONS CONFIG: what apps are allowed to make Home Assistant do.
 *
 *  Apps trigger an action with:
 *    POST /v1/actions/<name>
 *    Authorization: Bearer <GATEWAY_API_KEY>
 *    { "params": { ... } }            (optional)
 *
 *  Only actions listed here can run, and apps can only pass the params you
 *  declare. Entity IDs and HA service names stay here, never in app code.
 * ─────────────────────────────────────────────────────────────────────────────
 */
import type { ActionDefinition } from "../home-assistant/actions.js";

/**
 * Each key is the action name apps call. Each value is the HA service call it runs:
 * - `domain` + `service`: the HA service, e.g. light.turn_on. Find them in HA under
 *   Developer tools → Actions.
 * - `target`: which entities/areas/devices it affects. Fixed: apps can't change it.
 * - `serviceData`: fixed service data (e.g. brightness).
 * - `params`: values the app may pass, with their type ("string", "number" or "boolean").
 *   A param with the same key as serviceData overrides it, so serviceData works as defaults.
 */
export const actions = {
  // Sends a notification to Maddie's Pixel only: the target is fixed, so callers can't pick another device.
  test_phone_notification: {
    domain: "notify",
    service: "send_message",
    target: { entity_id: "notify.maddie_s_mobile" },
    serviceData: { title: "ha-gateway", message: "Test notification from ha-gateway" },
    params: { title: "string", message: "string" },
  },

  // Examples: uncomment and change the entity IDs to match your HA.
  //
  // flash_hallway: {
  //   domain: "light",
  //   service: "turn_on",
  //   target: { entity_id: "light.hallway" },
  //   serviceData: { flash: "short" },
  // },
  //
  // set_lounge_brightness: {
  //   domain: "light",
  //   service: "turn_on",
  //   target: { entity_id: "light.lounge" },
  //   serviceData: { brightness_pct: 100 },
  //   params: { brightness_pct: "number" },
  // },
  //
  // run_victory_script: {
  //   domain: "script",
  //   service: "turn_on",
  //   target: { entity_id: "script.victory" },
  // },
} satisfies Record<string, ActionDefinition>;
