/**
 * ─────────────────────────────────────────────────────────────────────────────
 *  EVENT CONFIG: the one place to decide what the gateway listens for and
 *  where it sends it.
 *
 *  1. LISTEN: `eventRules` turns Home Assistant state changes into gateway
 *     events. Add a rule to start emitting a new event type.
 *  2. POST: `webhooks` decides which of those events are POSTed to which app.
 *
 *  Every emitted event is also logged, whether or not a webhook takes it.
 * ─────────────────────────────────────────────────────────────────────────────
 */
import type { StateRule } from "../home-assistant/events.js";
import type { WebhookDestination } from "../routing/webhook.js";

/**
 * 1. LISTEN
 *
 * Each rule matches HA state changes and emits an event with `type`.
 * - `match`: all given conditions must hold (domain, deviceClass, entityId, toState).
 * - `data`: optional extra fields for the event, derived from the change.
 * - First matching rule wins, so put specific rules (exact entityIds) above broad ones.
 * - Attribute-only updates and changes to unavailable/unknown are already filtered out.
 *
 * Every event POSTed or logged has this shape:
 *   { type, entityId, name?, state, previousState, timestamp, data? }
 */
export const eventRules = [
  // Example of a specific-entity rule (keep these above the broad rules):
  // {
  //   type: "DOORBELL_PRESSED",
  //   match: { entityId: ["binary_sensor.front_doorbell"], toState: ["on"] },
  // },

  {
    type: "ZONE_ACTIVITY",
    match: { domain: ["binary_sensor"], deviceClass: ["motion", "occupancy", "presence"] },
    data: (t) => ({ active: t.to.state === "on" }),
  },
  {
    type: "CONTACT_CHANGED",
    match: { domain: ["binary_sensor"], deviceClass: ["door", "window", "garage_door", "opening"] },
    data: (t) => ({ open: t.to.state === "on" }),
  },
] as const satisfies readonly StateRule[];

/** All event types the gateway can emit, derived from the rules above. */
export type EventType = (typeof eventRules)[number]["type"];

/**
 * 2. POST
 *
 * Each destination receives a JSON POST for every event whose type is in `events`.
 * The URL (and optional bearer secret) are read from the named env vars, so set them
 * in Railway / .env. A destination whose URL env var is unset is skipped with a warning.
 */
export const webhooks = [
  {
    name: "cam-quest",
    events: ["ZONE_ACTIVITY"],
    urlEnv: "CAM_QUEST_WEBHOOK_URL",
    secretEnv: "CAM_QUEST_WEBHOOK_SECRET",
  },
] as const satisfies readonly WebhookDestination<EventType>[];
