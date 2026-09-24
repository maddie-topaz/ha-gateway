import type { Logger } from "../logger.js";
import type { HomeAssistantClient } from "./client.js";
import type { ServiceData, ServiceTarget } from "./types.js";

type ParamType = "string" | "number" | "boolean";

/** A named, pre-approved HA service call that apps may trigger. Apps list theirs in src/apps/. */
export type ActionDefinition = {
  readonly domain: string;
  readonly service: string;
  readonly target?: ServiceTarget;
  /** Fixed service data. Caller params with the same key override these, so they double as defaults. */
  readonly data?: ServiceData;
  /** Values the caller may pass, and their types. Anything not listed is rejected. */
  readonly params?: Record<string, ParamType>;
};

export class UnknownActionError extends Error {
  constructor(readonly action: string) {
    super(`Unknown action "${action}"`);
    this.name = "UnknownActionError";
  }
}

export class InvalidActionParamsError extends Error {
  constructor(readonly problems: string[]) {
    super(`Invalid params: ${problems.join("; ")}`);
    this.name = "InvalidActionParamsError";
  }
}

const SLUG = /^[a-z0-9_]+$/;

type ActionRunnerOptions = {
  actions: Record<string, ActionDefinition>;
  homeAssistant: Pick<HomeAssistantClient, "callService">;
  logger: Logger;
};

export const createActionRunner = ({ actions, homeAssistant, logger }: ActionRunnerOptions) => {
  const log = logger.child({ component: "actions" });

  // Catch config mistakes at startup rather than on the first call.
  for (const [name, action] of Object.entries(actions)) {
    if (!SLUG.test(name)) throw new Error(`Action name "${name}" must be lowercase letters, numbers and underscores`);
    if (!SLUG.test(action.domain) || !SLUG.test(action.service)) {
      throw new Error(`Action "${name}" has an invalid domain or service`);
    }
  }

  const parseParams = (action: ActionDefinition, input: unknown): ServiceData => {
    if (input === undefined || input === null) return {};
    if (typeof input !== "object" || Array.isArray(input)) throw new InvalidActionParamsError(["params must be an object"]);

    const allowed = action.params ?? {};
    const problems: string[] = [];
    for (const [key, value] of Object.entries(input)) {
      const expected = Object.hasOwn(allowed, key) ? allowed[key] : undefined;
      if (!expected) problems.push(`"${key}" is not an allowed param`);
      else if (typeof value !== expected) problems.push(`"${key}" must be a ${expected}`);
    }
    if (problems.length > 0) throw new InvalidActionParamsError(problems);
    // Every value was checked to be a string, number or boolean above.
    return input as ServiceData;
  };

  const run = async (name: string, params?: unknown) => {
    // hasOwn so names like "constructor" can't resolve to Object.prototype.
    const action = Object.hasOwn(actions, name) ? actions[name] : undefined;
    if (!action) throw new UnknownActionError(name);

    const values = parseParams(action, params);
    const started = performance.now();
    // callService logs failures, so only success is logged here.
    await homeAssistant.callService({
      domain: action.domain,
      service: action.service,
      ...(action.target && { target: action.target }),
      data: { ...action.data, ...values },
    });
    log.info({ action: name, ms: Math.round(performance.now() - started) }, "action executed");
  };

  const list = () => Object.entries(actions).map(([name, action]) => ({ name, params: action.params ?? {} }));

  return { run, list, count: () => Object.keys(actions).length };
};

export type ActionRunner = ReturnType<typeof createActionRunner>;
