/**
 * ─────────────────────────────────────────────────────────────────────────────
 *  APPS: every app the gateway serves.
 *
 *  Each app has its own file in this folder with its own event rules, actions,
 *  webhook and API key. Reusable rules and actions live in ./shared.
 *
 *  To add an app: copy cam-quest.ts, change the name and env var names,
 *  pick its events and actions, and add it to the list below.
 * ─────────────────────────────────────────────────────────────────────────────
 */
import { camQuest } from "./cam-quest.js";
import type { AppDefinition } from "./types.js";

export const apps: readonly AppDefinition[] = [camQuest];
