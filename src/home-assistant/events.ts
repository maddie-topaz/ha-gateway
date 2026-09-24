import type { CustomEvent, StateChangeEvent } from "../routing/types.js";
import type { HassEntityState, HassEvent, StateChangedEvent } from "./types.js";

/** A state_changed event where the state value itself changed (not just attributes). */
export type StateTransition = {
  entityId: string;
  domain: string;
  deviceClass: string | undefined;
  from: HassEntityState | null;
  to: HassEntityState;
};

/** Declarative rule turning matching HA state changes into a gateway event. Apps list theirs in src/apps/. */
export type StateRule<TType extends string = string> = {
  readonly type: TType;
  /** Every condition given must match. Omitted conditions match anything. */
  readonly match: {
    readonly domain?: readonly string[];
    readonly deviceClass?: readonly string[];
    readonly entityId?: readonly string[];
    /** Only fire when the entity changes *to* one of these states. */
    readonly toState?: readonly string[];
  };
  /** Extra fields to include on the event, derived from the change. */
  readonly data?: (transition: StateTransition) => Record<string, unknown>;
};

const IGNORED_STATES = new Set(["unavailable", "unknown"]);

/** Extracts a real state transition, filtering attribute-only updates, removals and unavailable/unknown noise. */
export const toTransition = (event: StateChangedEvent): StateTransition | null => {
  const { entity_id: entityId, old_state: from, new_state: to } = event.data ?? {};
  if (typeof entityId !== "string" || !to) return null;
  if (from && from.state === to.state) return null;
  if (IGNORED_STATES.has(to.state)) return null;

  const deviceClass = to.attributes?.device_class;
  return {
    entityId,
    domain: entityId.split(".", 1)[0] ?? "",
    deviceClass: typeof deviceClass === "string" ? deviceClass : undefined,
    from,
    to,
  };
};

const allows = (allowed: readonly string[] | undefined, value: string | undefined) =>
  allowed === undefined || (value !== undefined && allowed.includes(value));

const matches = ({ match }: StateRule, t: StateTransition) =>
  allows(match.domain, t.domain) &&
  allows(match.deviceClass, t.deviceClass) &&
  allows(match.entityId, t.entityId) &&
  allows(match.toState, t.to.state);

/** Builds a state_changed → GatewayEvent function from rules. The first matching rule wins. */
export const createStateChangeNormalizer =
  <TType extends string>(rules: readonly StateRule<TType>[]) =>
  (event: StateChangedEvent): StateChangeEvent<TType> | null => {
    const transition = toTransition(event);
    if (!transition) return null;

    const rule = rules.find((r) => matches(r, transition));
    if (!rule) return null;

    const { entityId, from, to } = transition;
    return {
      type: rule.type,
      entityId,
      ...(typeof to.attributes.friendly_name === "string" && { name: to.attributes.friendly_name }),
      state: to.state,
      previousState: from?.state ?? null,
      timestamp: to.last_changed,
      ...(rule.data && { data: rule.data(transition) }),
    };
  };

/**
 * Rule turning a custom HA event (fired by an automation's `event:` action) into a gateway event.
 * Unlike StateRule, it matches on the HA event type alone, so the gateway subscribes to `eventType` directly.
 */
export type CustomEventRule<TType extends string = string> = {
  readonly type: TType;
  /** The HA event type to listen for, e.g. `"cam_quest_phrase"`. */
  readonly eventType: string;
  /** Fields to put in the event's `data`. Defaults to the HA event's own data. */
  readonly data?: (event: HassEvent) => Record<string, unknown>;
};

/** Builds a HA event → GatewayEvent function for one custom event rule. */
export const createCustomEventNormalizer =
  <TType extends string>(rule: CustomEventRule<TType>) =>
  (event: HassEvent): CustomEvent<TType> => ({
    type: rule.type,
    timestamp: event.time_fired,
    data: rule.data ? rule.data(event) : event.data,
  });
