import type { ActionDefinition } from "../home-assistant/actions.js";
import type { StateRule } from "../home-assistant/events.js";

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
  /** What this app can make HA do, via POST /v1/actions/<name>. Keys are the action names. */
  readonly actions?: Record<string, ActionDefinition>;
};

/** Identity function that gives app files type-checking and autocomplete. */
export const defineApp = (app: AppDefinition) => app;
