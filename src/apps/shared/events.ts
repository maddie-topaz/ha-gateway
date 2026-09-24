/**
 * Reusable event rules. Apps pick the ones they want in their `events` list,
 * alongside any rules of their own.
 *
 * A rule turns matching HA state changes into an event with `type`:
 * - `match`: every condition given must hold (domain, deviceClass, entityId, toState).
 * - `data`: optional extra fields for the event, derived from the change.
 * Attribute-only updates and changes to unavailable/unknown are filtered out before rules run.
 */
import type { StateRule } from "../../home-assistant/events.js";

/** Motion, occupancy or presence detected or cleared. */
export const zoneActivity: StateRule = {
  type: "ZONE_ACTIVITY",
  match: { domain: ["binary_sensor"], deviceClass: ["motion", "occupancy", "presence"] },
  data: (t) => ({ active: t.to.state === "on" }),
};

/** A door, window, garage door or other opening opened or closed. */
export const contactChanged: StateRule = {
  type: "CONTACT_CHANGED",
  match: { domain: ["binary_sensor"], deviceClass: ["door", "window", "garage_door", "opening"] },
  data: (t) => ({ open: t.to.state === "on" }),
};
