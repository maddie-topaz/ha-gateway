import type { Logger } from "../logger.js";
import type { HomeAssistantClient } from "./client.js";
import type { JsonValue, ServiceData, ServiceTarget } from "./types.js";

type ParamType = "string" | "number" | "boolean";

/**
 * How an app-supplied param is checked, and where it goes in the service data.
 * - A bare type (`"string"`) puts the value at the top level, under the param's own name.
 * - `{ type, path }` puts it somewhere nested, e.g. `{ type: "string", path: ["data", "tts_text"] }`.
 */
export type ParamSpec = ParamType | { readonly type: ParamType; readonly path: readonly [string, ...string[]] };

/** A named, pre-approved HA service call that apps may trigger. Apps list theirs in src/apps/. */
export type ActionDefinition = {
  readonly domain: string;
  readonly service: string;
  readonly target?: ServiceTarget;
  /** Fixed service data. Caller params with the same key override these, so they double as defaults. */
  readonly data?: ServiceData;
  /** Values the caller may pass, their types, and optionally where they go. Anything not listed is rejected. */
  readonly params?: Record<string, ParamSpec>;
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
// Path segments that could reach Object.prototype if a config ever used them.
const FORBIDDEN_KEYS = new Set(["__proto__", "prototype", "constructor"]);

type MutableData = { [key: string]: JsonValue };

const normalizeSpec = (key: string, spec: ParamSpec) =>
  typeof spec === "string" ? { type: spec, path: [key] as const } : spec;

const isPlainObject = (value: unknown): value is MutableData =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** Returns a copy of `data` with `value` at `path`, copying each object along the way so the action's own data is never mutated. */
const withValueAt = (data: MutableData, path: readonly string[], value: JsonValue): MutableData => {
  const [head, ...rest] = path;
  if (head === undefined) return data;
  const next = data[head];
  return { ...data, [head]: rest.length === 0 ? value : withValueAt(isPlainObject(next) ? next : {}, rest, value) };
};

/** Config-time check that a param's path is safe and doesn't run into a fixed non-object value. */
const pathProblem = (action: ActionDefinition, path: readonly string[]) => {
  if (path.length === 0 || path.some((key) => key === "" || FORBIDDEN_KEYS.has(key))) return "has an invalid path";
  let node: unknown = action.data;
  for (const key of path.slice(0, -1)) {
    node = isPlainObject(node) ? node[key] : undefined;
    if (node !== undefined && !isPlainObject(node)) return `path ${path.join(".")} runs into a fixed value that isn't an object`;
  }
  return undefined;
};

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
    for (const [key, spec] of Object.entries(action.params ?? {})) {
      const problem = pathProblem(action, normalizeSpec(key, spec).path);
      if (problem) throw new Error(`Action "${name}" param "${key}" ${problem}`);
    }
  }

  /** Validates the caller's params and returns the full service data: the action's fixed data plus each param at its path. */
  const buildData = (action: ActionDefinition, input: unknown): ServiceData => {
    let data: MutableData = { ...action.data };
    if (input === undefined || input === null) return data;
    if (!isPlainObject(input)) throw new InvalidActionParamsError(["params must be an object"]);

    const allowed = action.params ?? {};
    const problems: string[] = [];
    for (const [key, value] of Object.entries(input)) {
      const spec = Object.hasOwn(allowed, key) ? allowed[key] : undefined;
      if (!spec) {
        problems.push(`"${key}" is not an allowed param`);
        continue;
      }
      const { type, path } = normalizeSpec(key, spec);
      if (typeof value !== type) problems.push(`"${key}" must be a ${type}`);
      // Checked above to be a string, number or boolean.
      else data = withValueAt(data, path, value as JsonValue);
    }
    if (problems.length > 0) throw new InvalidActionParamsError(problems);
    return data;
  };

  const run = async (name: string, params?: unknown) => {
    // hasOwn so names like "constructor" can't resolve to Object.prototype.
    const action = Object.hasOwn(actions, name) ? actions[name] : undefined;
    if (!action) throw new UnknownActionError(name);

    const data = buildData(action, params);
    const started = performance.now();
    // callService logs failures, so only success is logged here.
    await homeAssistant.callService({
      domain: action.domain,
      service: action.service,
      ...(action.target && { target: action.target }),
      data,
    });
    log.info({ action: name, ms: Math.round(performance.now() - started) }, "action executed");
  };

  // Apps only need each param's type, not where it ends up in the HA call.
  const list = () =>
    Object.entries(actions).map(([name, action]) => ({
      name,
      params: Object.fromEntries(Object.entries(action.params ?? {}).map(([key, spec]) => [key, normalizeSpec(key, spec).type])),
    }));

  return { run, list, count: () => Object.keys(actions).length };
};

export type ActionRunner = ReturnType<typeof createActionRunner>;
