import type { AlexaReplies } from "../alexa/skill.js";
import type { ActionDefinition } from "../home-assistant/actions.js";
import type { CustomEventRule, StateRule } from "../home-assistant/events.js";

/** Everything one app gets from the gateway. Each app lives in its own file in src/apps/. */
export type AppDefinition = {
  /** Lowercase letters, numbers and dashes. Shows up in logs. */
  readonly name: string;
  /** Env var holding this app's API key (32+ characters). The key decides which app's actions a request can run. */
  readonly apiKeyEnv: string;
  /** Where to POST this app's events. Omit if the app doesn't want events. */
  readonly webhook?: {
    /** Env var holding the URL. If unset, events for this app are only logged. */
    readonly urlEnv: string;
    /** Env var holding a secret, sent as `Authorization: Bearer <secret>`. */
    readonly secretEnv?: string;
  };
  /** Which HA state changes this app hears about. The first matching rule wins. */
  readonly events?: readonly StateRule[];
  /** Which custom HA events (fired by automations) this app hears about, by HA event type. */
  readonly customEvents?: readonly CustomEventRule[];
  /**
   * An Alexa custom skill whose phrases reach this app as PHRASE_HEARD events.
   * Its endpoint is `/v1/alexa/<app name>`. See README: Alexa phrases.
   */
  readonly alexa?: {
    /** Env var holding the skill ID (amzn1.ask.skill.…). Only that skill can reach this app. */
    readonly skillIdEnv: string;
    /** What Alexa says back. Anything left out uses the defaults in src/alexa/skill.ts. */
    readonly replies?: Partial<AlexaReplies>;
  };
  /** What this app can make HA do, via POST /v1/actions/<name>. Keys are the action names. */
  readonly actions?: Record<string, ActionDefinition>;
};

/** Identity function that gives app files type-checking and autocomplete. */
export const defineApp = (app: AppDefinition) => app;
