# ha-gateway

ha-gateway keeps one always-on connection to Home Assistant and works in both directions:

- **Events out:** motion in the hallway, a door opening, a doorbell press. The gateway picks these up, gives them a consistent shape, and POSTs them to whichever app cares.
- **Actions in:** apps ask the gateway to do things like flash a light or run a script. They can only trigger actions you've approved.

```text
Home Assistant
      ↕ persistent WebSocket
ha-gateway (Railway)
      ↓ POST events          ↑ POST /v1/actions/<name>
Cam Quest / future apps
```

Your apps never talk to Home Assistant directly and never see the HA token. They receive events and call actions, and that's it. The gateway doesn't know anything about quests, players or game rules, so the same gateway can serve any number of apps.

## Contents

- [Quick start (local)](#quick-start-local)
- [Deploy to Railway](#deploy-to-railway)
- [Check it's working](#check-its-working)
- [Apps](#apps)
- [Choose which events an app gets](#choose-which-events-an-app-gets)
- [Receive events in your app](#receive-events-in-your-app)
- [Let an app trigger actions](#let-an-app-trigger-actions)
- [Alexa phrases](#alexa-phrases)
- [Troubleshooting](#troubleshooting)
- [Environment variables](#environment-variables)
- [HTTP API](#http-api)
- [How it works](#how-it-works)
- [Calling Home Assistant from gateway code](#calling-home-assistant-from-gateway-code)

## Quick start (local)

You'll need Node 22+ and a Home Assistant long-lived access token. In HA, open your profile, go to **Security → Long-lived access tokens → Create token** and copy it (HA only shows it once).

```bash
cp .env.example .env
```

Fill in `HA_URL` and `HA_TOKEN` in `.env`, then:

```bash
npm install
npm run dev
```

In another terminal:

```bash
curl localhost:3000/health
```

You should see `"homeAssistant":"connected"`. Trigger a motion sensor or open a door, and a `normalized event received` line will show up in the dev server's output.

## Deploy to Railway

1. **Make Home Assistant reachable from the internet.** Railway runs in the cloud, so it can't see `homeassistant.local`. Use your Nabu Casa URL (`https://xxxx.ui.nabu.casa`) or a Cloudflare Tunnel, and always use `https`.
2. **Create the service.** On railway.com, pick **New Project → Deploy from GitHub repo** and choose this repo. `railway.json` already sets the build command, start command, health check and restart policy, so there's nothing else to configure there.
3. **Add variables.** Open the service, go to the **Variables** tab and add at least `HA_URL` and `HA_TOKEN` (see [Environment variables](#environment-variables) for the rest). Add them on the service itself, not only as project-level Shared Variables.
4. **Deploy.** Railway stages variable changes, so click **Deploy** (or "Apply changes") if it doesn't start on its own.
5. **Give it a domain.** Under **Settings → Networking**, click **Generate Domain** so you can reach `/health`.

From then on, every push to `main` redeploys automatically.

For reference, `railway.json` sets:

| Setting | Value |
| --- | --- |
| Build command | `npm run build` |
| Start command | `node dist/index.js` |
| Health check path | `/health` |
| Restart policy | Always |

## Check it's working

**Health check:**

```bash
curl https://YOUR-DOMAIN/health
```

```json
{ "status": "ok", "homeAssistant": "connected", "uptimeSeconds": 1234 }
```

`homeAssistant` tells you where the connection is at:

| Value | Meaning |
| --- | --- |
| `connected` | All good. |
| `connecting` / `authenticating` | Mid-connect, give it a few seconds. |
| `disconnected` | Can't reach HA right now. The gateway keeps retrying on its own. |
| `auth_failed` | HA rejected the token. The gateway stops retrying so it doesn't get your IP banned. Fix `HA_TOKEN` and redeploy. |

`/health` returns 200 even when HA is down (with `"status": "degraded"`). That's on purpose, so an HA outage doesn't fail your deploys or make Railway restart a service that's working fine.

**Logs.** In Railway, open **Deployments → View logs**. A healthy start looks like this:

```text
service starting
http server listening
ha connecting
ha authenticated
ha subscription created
```

After that you'll see `normalized event received` for each event and `webhook delivered` for each successful POST. If HA restarts, you'll see `ha connection lost`, a few `ha reconnect attempt` lines, then `ha reconnected`. You don't need to do anything.

## Apps

Every app the gateway serves (Cam Quest, a dashboard, whatever comes next) gets its own folder in **[`src/apps/`](src/apps/)**. Its `index.ts` is the whole contract between the gateway and the app:

```ts
// src/apps/cam-quest/index.ts
export const camQuest = defineApp({
  name: "cam-quest",
  apiKeyEnv: "CAM_QUEST_API_KEY",
  webhook: { urlEnv: "CAM_QUEST_WEBHOOK_URL", secretEnv: "CAM_QUEST_WEBHOOK_SECRET" },

  events: [zoneActivity],

  actions: {
    test_phone_notification: notifyMaddiesPhone,
  },
});
```

| Field | What it's for |
| --- | --- |
| `name` | Shows up in logs. Lowercase letters, numbers and dashes. |
| `apiKeyEnv` | The env var holding this app's API key. The key is how the gateway knows which app is calling, so each app can only run its own actions. |
| `webhook` | The env vars holding the URL (and optional secret) this app's events are POSTed to. Leave it out if the app doesn't want events. |
| `events` | Which Home Assistant changes this app hears about. See [below](#choose-which-events-an-app-gets). |
| `actions` | What this app can make Home Assistant do. See [below](#let-an-app-trigger-actions). |

Apps don't share anything unless you choose to. Cam Quest only gets the events in its own `events` list, and it can't see or call another app's actions.

**Shared building blocks.** Rules and actions that more than one app might want live in [`src/apps/shared/`](src/apps/shared/). Apps compose them with rules and actions of their own:

```ts
events: [zoneActivity, contactChanged, doorbellPressed],
actions: {
  test_phone_notification: notifyMaddiesPhone,
  celebrate: celebrateTvLight,
},
```

### Add a new app

1. Copy the `src/apps/cam-quest/` folder to a new one, like `src/apps/dashboard/`, and rename the export (`camQuest` → `dashboard`).
2. Change the `name` and the env var names (`DASHBOARD_API_KEY`, `DASHBOARD_WEBHOOK_URL`, …), then pick its events and actions.
3. Import it in [`src/apps/index.ts`](src/apps/index.ts) and add it to the `apps` list.
4. Set its variables in Railway. Generate its API key with `openssl rand -hex 32`. Every app needs a different key, and the gateway won't start if two apps share one.
5. Push.

## Choose which events an app gets

An app's `events` list holds rules. Each rule turns matching Home Assistant changes into an event with a `type`:

```ts
export const zoneActivity: StateRule = {
  type: "ZONE_ACTIVITY",
  match: { domain: ["binary_sensor"], deviceClass: ["motion", "occupancy", "presence"] },
  data: (t) => ({ active: t.to.state === "on" }),
};
```

`match` can use any of these, and every condition you include has to match:

| Condition | Matches on | Example |
| --- | --- | --- |
| `domain` | The part of the entity ID before the dot | `["binary_sensor", "light"]` |
| `deviceClass` | The entity's device class in HA | `["motion", "door"]` |
| `entityId` | Exact entities | `["binary_sensor.front_doorbell"]` |
| `toState` | Only fire when it changes *to* one of these | `["on"]` |

`data` is optional and adds extra fields to the event.

**To add an event to an app:**

1. Find the entity in HA (**Settings → Devices & services → Entities**) and note its entity ID and device class.
2. Write the rule. If other apps might want it, put it in `src/apps/shared/events.ts`. If it's only for this app, it can go in the app's own folder.
3. Add it to the app's `events` list. Put rules for specific entities *above* broad ones, because the first matching rule wins (checked per app).
4. Push. Railway redeploys and the new events show up in the logs.

For example, a doorbell rule only Cam Quest cares about:

```ts
events: [
  { type: "DOORBELL_PRESSED", match: { entityId: ["binary_sensor.front_door_mqtt_ding"], toState: ["on"] } },
  zoneActivity,
],
```

Attribute-only updates (the state didn't actually change) and changes to `unavailable` or `unknown` are filtered out before any rule runs. Anything an app's rules don't match is dropped for that app, so each app only ever gets events it asked for.

**Shared rules available now:**

| Rule | Type | Fires when | `data` |
| --- | --- | --- | --- |
| `zoneActivity` | `ZONE_ACTIVITY` | A motion, occupancy or presence sensor changes | `{ active: boolean }` |
| `contactChanged` | `CONTACT_CHANGED` | A door, window, garage door or opening sensor changes | `{ open: boolean }` |

### Custom events from HA automations

Some things aren't an entity changing state, like a voice phrase. For those, a HA automation fires a custom event with its own data, and the app lists the event types it wants in `customEvents`:

```ts
customEvents: [phraseHeard("cam_quest_phrase")],
```

A custom event rule has a `type` (the event type your app receives), an `eventType` (the HA event to listen for) and an optional `data` function. Without `data`, the HA event's own data is passed through as-is. The gateway subscribes to each `eventType` directly, so any automation that fires it reaches the app.

| Shared rule | Type | Fires when | `data` |
| --- | --- | --- | --- |
| `phraseHeard(eventType)` | `PHRASE_HEARD` | A HA automation fires `eventType` | The automation's `event_data`, e.g. `{ phrase: "open the portal" }` |

### Voice phrases

The gateway can't hear anything. HA Assist does the listening, from the companion app on a phone or a voice device like the Home Assistant Voice Preview Edition, and an automation passes the phrase on. For Cam Quest:

1. Make sure Assist can turn speech into text: **Settings → Voice assistants** needs a speech-to-text engine (Home Assistant Cloud, or the Whisper add-on).
2. Add this automation (**Settings → Automations → Create → ⋮ → Edit in YAML**):

   ```yaml
   alias: Cam Quest - phrase heard
   triggers:
     - trigger: conversation
       command: "cast {spell}"
   actions:
     - event: cam_quest_phrase
       event_data:
         phrase: "{{ trigger.slots.spell }}"
         sentence: "{{ trigger.sentence }}"
         source: assist
     - set_conversation_response: "Casting {{ trigger.slots.spell }}..."
   ```

3. Open Assist (in the companion app, or say the wake word to a voice device) and say "cast open the portal". Cam Quest receives `PHRASE_HEARD` with `data: { phrase: "open the portal", sentence: "cast open the portal", source: "assist" }`.

New phrases need no gateway or HA changes, because the app decides what each phrase does. Phrases said to an Echo arrive as the same `PHRASE_HEARD` event, with `source: "alexa"` (see [Alexa phrases](#alexa-phrases)). To test without speaking, fire `cam_quest_phrase` from **Developer tools → Events** with data `phrase: open the portal`.

## Receive events in your app

If the app has a `webhook` and its URL variable is set in Railway, each event arrives as a `POST` with a JSON body:

```http
POST /your/webhook/path
Content-Type: application/json
Authorization: Bearer <the app's webhook secret>
```

```json
{
  "type": "ZONE_ACTIVITY",
  "entityId": "binary_sensor.hallway_motion",
  "name": "Hallway Motion",
  "state": "on",
  "previousState": "off",
  "timestamp": "2026-09-24T11:07:48.797Z",
  "data": { "active": true }
}
```

| Field | Description |
| --- | --- |
| `type` | The event type from the rule that matched. |
| `entityId` | The HA entity that changed. |
| `name` | The entity's friendly name in HA, if it has one. |
| `state` / `previousState` | The new and old HA state. `previousState` is `null` if HA had no earlier state. |
| `timestamp` | When the state changed in HA (ISO 8601). |
| `data` | Extra fields from the rule, if it defines any. |

Events from [custom events](#custom-events-from-ha-automations) have no entity, so they only carry `type`, `timestamp` (when HA fired the event) and `data`:

```json
{ "type": "PHRASE_HEARD", "timestamp": "2026-09-25T10:05:00.000Z", "data": { "phrase": "open the portal" } }
```

Your endpoint should:

- **Check the secret** in the `Authorization` header and reject anything that doesn't match.
- **Respond with a 2xx within 5 seconds.** Do slow work after responding.
- **Keep game logic in your app.** The gateway just delivers the facts.

A minimal receiver with Fastify:

```ts
app.post("/ha-events", async (request, reply) => {
  if (request.headers.authorization !== `Bearer ${process.env.HA_GATEWAY_WEBHOOK_SECRET}`) {
    return reply.code(401).send();
  }

  const event = request.body as { type: string; entityId: string; data?: Record<string, unknown> };
  if (event.type === "ZONE_ACTIVITY") {
    // award XP, start a quest step, etc.
  }

  return reply.code(204).send();
});
```

If the URL variable isn't set, the app's events are only logged and the gateway warns about it at startup. Webhook URLs must use `https` (plain `http` is only allowed for `localhost`), and the gateway won't start if one doesn't.

Heads up, failed deliveries (timeouts or non-2xx responses) are logged as `event consumer failed` but **not retried**. If your app is down, it misses those events.

## Let an app trigger actions

Actions are how apps make things happen in Home Assistant. An app can only run the actions in its own `actions` list, and it calls them by name, so it never needs entity IDs or HA service names.

### 1. Define the action

Each action is a fixed Home Assistant service call:

```ts
export const notifyMaddiesPhone: ActionDefinition = {
  domain: "notify",
  service: "send_message",
  target: { entity_id: "notify.maddie_s_mobile" },
  data: { title: "ha-gateway", message: "Test notification from ha-gateway" },
  params: { title: "string", message: "string" },
};
```

| Field | Description |
| --- | --- |
| `domain` + `service` | The HA service to run, like `light.turn_on`. Try it in HA under **Developer tools → Actions** first. |
| `target` | Which entities it affects. It's fixed, so an app can't point an action at something else. |
| `data` | Fixed values sent with the call. |
| `params` | Values the app is allowed to pass, and their type (`"string"`, `"number"` or `"boolean"`). A param with the same name as a `data` value overrides it, so `data` doubles as defaults. If the value needs to go somewhere nested, give it a path: `{ type: "string", path: ["data", "tts_text"] }`. |

**Shared actions available now** (in [`src/apps/shared/actions.ts`](src/apps/shared/actions.ts)):

| Action | What it does | Params |
| --- | --- | --- |
| `notifyMaddiesPhone` | Sends a notification to Maddie's Pixel. | `title`, `message` |
| `phoneNotify(notifyEntityId, defaults?)` | Sends a notification to any phone, e.g. `phoneNotify("notify.cams_iphone")`. On an iPhone with Announce Notifications on for the Home Assistant app, Siri reads it aloud through AirPods or CarPlay. | `title`, `message` |
| `alexaSay(echoEntityId)` | Makes the chosen Echo say the app's message. Pass `{ type: "tts" }` to skip the announcement chime. **Needs the Alexa Media Player integration, which isn't installed yet.** | `message` |
| `phoneSay(notifyService)` | Makes an Android phone read the app's message out loud, on media volume. For Maddie's Pixel: `phoneSay("mobile_app_maddie_s_pixel")`. Not supported on iPhones: use `phoneNotify` for those. | `message` |
| `turnOnAction(entityIds, { data?, params? })` | Turns one or more entities on, e.g. `turnOnAction("light.upstairs_lamp", { data: { brightness_pct: 80 } })`. Add `params: { brightness_pct: "number" }` to let the app choose. | Only what you allow |
| `turnOffAction(entityIds)` / `toggleAction(entityIds)` | Turns entities off, or toggles them. Several entities must share a domain (all lights, say). | None |
| `speakOn(mediaPlayerEntityId)` | Makes a speaker or TV say the app's message using HA's text-to-speech. Candidates: `media_player.upstairs_speaker`, `shield`, `shield_2`, `downstairs`, `coreelec`. Test one before relying on it. | `message` |

`phoneNotify`, `alexaSay`, `phoneSay`, `speakOn` and the on/off builders are functions because each app picks its own device: `say_upstairs: speakOn("media_player.upstairs_speaker")`.

Put actions more than one app might use in `src/apps/shared/actions.ts`. Never add actions for locks, the alarm, sirens, the garage door or camera motion detection. The on/off builders enforce this: they refuse `lock`, `alarm_control_panel`, `siren` and `cover` entities, and anything with alarm, siren, lock, garage or motion_detection in its name, so the gateway won't start with one. A bug in an app or a leaked key shouldn't be able to open the house.

### 2. Give it to the app

Add it to the app's `actions` under the name the app will call. Names are lowercase letters, numbers and underscores. The same shared action can have different names in different apps.

```ts
actions: {
  test_phone_notification: notifyMaddiesPhone,
},
```

### 3. Call it from the app

The app sends its own API key (the value of its `apiKeyEnv` variable in Railway):

```bash
curl -X POST https://YOUR-DOMAIN/v1/actions/test_phone_notification \
  -H "Authorization: Bearer $CAM_QUEST_API_KEY"
```

With params:

```bash
curl -X POST https://YOUR-DOMAIN/v1/actions/test_phone_notification \
  -H "Authorization: Bearer $CAM_QUEST_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"params": {"title": "Cam Quest", "message": "Quest complete"}}'
```

From TypeScript:

```ts
const triggerAction = async (name: string, params?: Record<string, unknown>) => {
  const response = await fetch(`${process.env.HA_GATEWAY_URL}/v1/actions/${name}`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${process.env.HA_GATEWAY_API_KEY}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ params }),
  });
  if (!response.ok) throw new Error(`Action ${name} failed: ${response.status} ${await response.text()}`);
};

await triggerAction("test_phone_notification", { message: "Quest complete" });
```

`GET /v1/actions` with the same key lists that app's actions and the params each one accepts. Every action's URL is `/v1/actions/<name>`.

### Responses

| Status | Meaning |
| --- | --- |
| `200` | Done. HA accepted the call. Body: `{ "ok": true, "action": "test_phone_notification" }` |
| `400` | Bad params. `problems` lists each one, like `"brightness_pct" must be a number`. |
| `401` | Missing or wrong API key. |
| `404` | This app has no action with that name (including actions that belong to another app). |
| `502` | HA rejected the call, usually a typo in the entity ID or service. `code` has HA's error code. |
| `503` | HA isn't connected right now, or no app has an API key set. Safe to retry later. |
| `504` | HA didn't answer within 10 seconds. |

Actions aren't retried or queued. If HA is down, the call fails straight away with a 503 and the app decides whether to try again.

## Alexa phrases

An app can have its own Alexa custom skill, so anything said to an Echo after the skill's name reaches the app as a `PHRASE_HEARD` event:

> "Alexa, ask the spellbook to cast open the portal"

```json
{ "type": "PHRASE_HEARD", "timestamp": "2026-09-25T10:05:00Z", "data": { "phrase": "open the portal", "source": "alexa" } }
```

Alexa then speaks the app's reply and the conversation ends. Saying only "Alexa, open the spellbook" makes Alexa ask for a phrase and wait. Home Assistant isn't involved: Alexa calls the gateway directly.

The app opts in with `alexa` in its definition:

```ts
alexa: {
  skillIdEnv: "CAM_QUEST_ALEXA_SKILL_ID",
  replies: { launch: "Speak your spell.", heard: (phrase) => `${phrase}. So it shall be.` },
},
```

`replies` is optional. Anything left out uses the defaults in `src/alexa/skill.ts` (`launch`, `heard`, `help`, `goodbye`, `notUnderstood`).

**Create the skill** at [developer.amazon.com](https://developer.amazon.com/alexa/console/ask), signed in with the Amazon account the Echo is registered to. Skills in development only work on that account's own devices.

1. **Create Skill.** Any name. Choose a **Custom** model, **Provision your own** hosting, and **Start from scratch**. The language must match the Echo's (English (US) and English (UK) are different), or the skill silently won't respond.
2. **Invocation name**, e.g. `the spellbook`. Lowercase, usually two or more words, and without "alexa", "echo", "skill" or "app".
3. **Intents → Add intent → Create custom intent** named `PhraseIntent`. Add a slot named `phrase` of type `AMAZON.SearchQuery`, then these sample utterances:
   ```text
   cast {phrase}
   the password is {phrase}
   say {phrase}
   ```
   A `SearchQuery` slot can't be the whole utterance, which is why each one starts with a word like "cast".
4. **Endpoint → HTTPS.** Default region: `https://<your gateway domain>/v1/alexa/<app name>`, e.g. `https://ha-gateway-production.up.railway.app/v1/alexa/cam-quest`. For the certificate, choose **My development endpoint is a sub-domain of a domain that has a wildcard certificate from a certificate authority**.
5. **Build Model**, then on the **Test** tab set testing to **Development**.
6. Copy the **Skill ID** (`amzn1.ask.skill.…`, under the skill's name in the skills list) into the app's skill ID variable in Railway, e.g. `CAM_QUEST_ALEXA_SKILL_ID`, and deploy.

Try it from the **Test** tab by typing "ask the spellbook to cast open the portal". This works before touching a real Echo, and the gateway logs show `alexa phrase heard`. You can build and test the skill on your own Amazon account first, then create it again on the Echo owner's account later. Only the skill ID variable changes.

**Security:** there's no API key, since Alexa can't send one. Instead every request must carry Amazon's signature, made with a certificate for `echo-api.amazon.com` that leads to a trusted root, be less than 150 seconds old and name the app's own skill ID. Anything else gets a `400` and is logged as `alexa request rejected`.

## Troubleshooting

| What you see | What to do |
| --- | --- |
| `Invalid configuration: HA_URL is required` | Railway isn't passing the variables through. Add them on the service's own **Variables** tab (not only as Shared Variables), then click **Deploy** to apply the staged changes. |
| `/health` shows `auth_failed` | The token is wrong or was deleted in HA. Create a new one, update `HA_TOKEN`, redeploy. |
| Logs repeat `ha connection attempt failed` | Railway can't reach `HA_URL`. Open that URL from your phone on mobile data to check it's public. |
| `ha socket error` with `ENOTFOUND` | Typo in `HA_URL`, or you're using a local address like `homeassistant.local`. |
| An entity changes but an app gets no event | None of that app's rules match it. Check the entity's device class in HA against the app's `events`. `LOG_LEVEL=debug` shows every raw change the gateway receives. |
| An action returns `401` | The key doesn't match the app's API key variable in Railway. Keys from before the per-app change (`GATEWAY_API_KEY`) no longer work. |
| An action returns `404` | The action isn't in that app's `actions`, or the URL is missing `/v1`, or the request is a GET instead of a POST. |
| An action returns `502` | HA didn't accept the service call. Run the same call in HA under **Developer tools → Actions** to find the problem. |
| Alexa says "There was a problem with the requested skill's response" | Check the gateway logs. `alexa request rejected` means the check failed: usually the skill ID variable doesn't match the skill, or the endpoint URL has the wrong app name. No log line at all means the endpoint URL is wrong. |
| Alexa says it doesn't know that, or opens something else | The phrase didn't match a sample utterance, or the invocation name was misheard. Try the same sentence typed into the skill's **Test** tab. |
| Events are logged but the app gets nothing | Look for the startup warning about the app's webhook URL not being set, or `event consumer failed` (the app's endpoint errored or took longer than 5 seconds). |

## Environment variables

| Variable | Required | Description |
| --- | --- | --- |
| `HA_URL` | Yes | Your HA URL, like `https://xxxx.ui.nabu.casa`. A `wss://…/api/websocket` URL works too. |
| `HA_TOKEN` | Yes | HA long-lived access token. Never logged or sent to apps. |
| `LOG_LEVEL` | No | `info` by default. `debug` also logs raw HA events. |
| `PORT` | No | Railway sets this for you. Defaults to `3000` locally. |
| `HOST` | No | Defaults to `0.0.0.0`. |

Each app adds its own variables, named in its folder in `src/apps/`. For Cam Quest:

| Variable | Description |
| --- | --- |
| `CAM_QUEST_API_KEY` | Cam Quest's key for calling its actions. 32+ characters. |
| `CAM_QUEST_WEBHOOK_URL` | Where Cam Quest's events are POSTed. |
| `CAM_QUEST_WEBHOOK_SECRET` | Sent as `Authorization: Bearer …` with those POSTs. |
| `CAM_QUEST_ALEXA_SKILL_ID` | Cam Quest's Alexa skill ID (`amzn1.ask.skill.…`). Unset turns its Alexa endpoint off. See [Alexa phrases](#alexa-phrases). |

The service refuses to start if anything required is missing or invalid, and the error lists every problem at once. Optional things that are missing (like an app's webhook URL) are logged as warnings at startup.

## HTTP API

| Route | Auth | Description |
| --- | --- | --- |
| `GET /health` | None | Service and HA connection status. |
| `GET /v1/status` | App API key | More detail: which app you are, HA version, active subscriptions. |
| `GET /v1/actions` | App API key | Lists the calling app's actions and the params each accepts. |
| `POST /v1/actions/:name` | App API key | Runs one of the calling app's actions. See [Let an app trigger actions](#let-an-app-trigger-actions). |
| `POST /v1/alexa/:app` | Amazon's request signature | The endpoint for an app's Alexa skill. See [Alexa phrases](#alexa-phrases). |

## How it works

1. The gateway opens a WebSocket to HA, authenticates with the token and subscribes to `state_changed`, plus each custom event type an app lists in `customEvents`.
2. Each change is checked against every app's `events` rules separately. A match becomes an event for that app, and everything else is dropped. Custom events go straight to the apps that asked for them.
3. Every event is logged and POSTed to the app it belongs to.
4. When an app calls `POST /v1/actions/<name>`, the gateway works out which app it is from the API key, checks the action is in that app's list and the params are allowed, then runs the service call over the same HA connection.
5. A ping every 30 seconds catches dead connections. If the connection drops, the gateway reconnects with exponential backoff (1 second, doubling up to 60), then re-subscribes automatically.
6. On shutdown (`SIGTERM` from Railway), it closes the HTTP server and the HA connection cleanly.

```text
src/
├── index.ts              Startup, wiring and shutdown
├── logger.ts             Structured logging (secrets are redacted)
├── apps/                 ★ One folder per app, plus the list of apps
│   └── shared/           ★ Reusable event rules and actions
├── config/env.ts         Environment variable validation
├── alexa/                Alexa skill endpoint: request verification and replies
├── api/                  HTTP server (/health, /v1) and per-app key auth
├── home-assistant/       Everything HA-specific: connection, service calls and helpers, state queries, actions, rule matching
└── routing/              Event router, webhook delivery and the event shape
```

Scripts: `npm run dev` (local, auto-reloads), `npm test`, `npm run typecheck`, `npm run build` (compiles to `dist/`), `npm start` (runs the build).

## Calling Home Assistant from gateway code

This section is for working on the gateway itself. Apps never call these directly: they only get the actions in their folder in `src/apps/`.

Every Home Assistant service call goes through one function, `callService`, in [`src/home-assistant/services.ts`](src/home-assistant/services.ts). It sends the call over the gateway's existing authenticated connection, so nothing else needs the token or knows the wire protocol.

```ts
await homeAssistant.callService({
  domain: "light",
  service: "turn_on",
  target: { entity_id: "light.living_room" },
  data: { brightness_pct: 30, rgb_color: [145, 50, 255] },
});
```

`target` and `data` are optional. `data` is typed as JSON, so anything that can't be sent to HA won't compile. Set `returnResponse: true` for services that return data, like `weather.get_forecasts`, and read it from `result.response`.

**Helpers** in [`src/home-assistant/service-helpers.ts`](src/home-assistant/service-helpers.ts) cover common calls. They work out the domain from the entity ID:

```ts
await homeAssistant.turnOn("light.study_lamps", { brightness_pct: 50 });
await homeAssistant.turnOff("fan.skyfan_dc");
await homeAssistant.toggle("switch.camputer");
```

To add a helper (like `setLight`, `activateScene`, `sendNotification` or `playMedia`), add a function to `createServiceHelpers` that builds the arguments and calls `callService` or `callOnEntity`. Don't send anything to HA directly. That keeps errors, logging and validation in one place.

**Errors.** Every failure is a `HomeAssistantError`, so one `instanceof` check catches them all. The subclass tells you what went wrong:

| Error | Meaning |
| --- | --- |
| `HomeAssistantInvalidRequestError` | Malformed domain, service or entity ID. Nothing was sent to HA. |
| `HomeAssistantNotConnectedError` | No connection to HA right now. Safe to retry later. |
| `HomeAssistantTimeoutError` | HA didn't answer within 10 seconds. The call may or may not have run. |
| `HomeAssistantCommandError` | HA rejected the call. `code` has HA's error code, like `service_not_found`. |
| `HomeAssistantInvalidResponseError` | HA answered, but not in the expected shape. |

**Logging.** Failed calls log `ha service call failed` at `warn` with the service name, target and HA's error code. Successful calls log `ha service called` at `debug`. Data values are never logged, only their keys, because they can hold things like message text.

**Tests** use Node's built-in test runner. `npm test` runs every `*.test.ts` file, including one that runs the real connection against a fake Home Assistant server.

If something here is unclear or out of date, open an issue or update this README in the same PR as the change.
