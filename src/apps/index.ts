/**
 * ─────────────────────────────────────────────────────────────────────────────
 *  APPS: every app the gateway serves.
 *
 *  Each app has its own folder here (e.g. ./cam-quest) with its own event rules,
 *  actions, webhook and API key. Reusable rules and actions live in ./shared.
 *
 *  To add an app: copy the cam-quest folder, change the name and env var names,
 *  pick its events and actions, and add it to the list below.
 * ─────────────────────────────────────────────────────────────────────────────
 */
import { camQuest } from "./cam-quest/index.js";
import type { AppDefinition } from "./types.js";

export const apps: readonly AppDefinition[] = [camQuest];
