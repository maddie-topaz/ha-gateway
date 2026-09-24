# ha-gateway

ha-gateway keeps one always-on connection to Home Assistant and turns what happens in your home into clean events your apps can use. Motion in the hallway, a door opening, a doorbell press: the gateway picks them up, gives them a consistent shape, and POSTs them to whichever app cares.

```text
Home Assistant
      ↕ persistent WebSocket
ha-gateway (Railway)
      ↕ HTTP POST
Cam Quest / future apps
```

Your apps never talk to Home Assistant directly and never see the HA token. They just receive events. The gateway doesn't know anything about quests, players or game rules, so the same gateway can serve any number of apps.

## Contents

- [Quick start (local)](#quick-start-local)
- [Deploy to Railway](#deploy-to-railway)
- [Check it's working](#check-its-working)
- [Choose which events to listen for](#choose-which-events-to-listen-for)
- [Send events to your app](#send-events-to-your-app)
- [Receive events in your app](#receive-events-in-your-app)
- [Troubleshooting](#troubleshooting)
- [Environment variables](#environment-variables)
- [HTTP API](#http-api)
- [How it works](#how-it-works)

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

## Choose which events to listen for

Everything about events lives in one file: **[`src/config/events.ts`](src/config/events.ts)**. The first list in it, `eventRules`, decides which Home Assistant changes become gateway events.

Each rule has a `type` (the event name your apps will see) and a `match`:

```ts
{
  type: "ZONE_ACTIVITY",
  match: { domain: ["binary_sensor"], deviceClass: ["motion", "occupancy", "presence"] },
  data: (t) => ({ active: t.to.state === "on" }),
},
```

`match` can use any of these, and every condition you include has to match:

| Condition | Matches on | Example |
| --- | --- | --- |
| `domain` | The part of the entity ID before the dot | `["binary_sensor", "light"]` |
| `deviceClass` | The entity's device class in HA | `["motion", "door"]` |
| `entityId` | Exact entities | `["binary_sensor.front_doorbell"]` |
| `toState` | Only fire when it changes *to* one of these | `["on"]` |

`data` is optional and adds extra fields to the event.

**To add a new event:**

1. Find the entity in HA (**Settings → Devices & services → Entities**) and note its entity ID and device class.
2. Add a rule to `eventRules`. Put rules for specific entities *above* the broad ones, because the first matching rule wins.
3. Push. Railway redeploys and the new events show up in the logs.

For example, a doorbell:

```ts
{
  type: "DOORBELL_PRESSED",
  match: { entityId: ["binary_sensor.front_doorbell"], toState: ["on"] },
},
```

A few things are filtered out before rules run, so you don't need to handle them: attribute-only updates (the state didn't actually change) and changes to `unavailable` or `unknown`. Anything no rule matches is dropped, so your apps only ever get events you asked for.

**Events available now:**

| Type | Fires when | `data` |
| --- | --- | --- |
| `ZONE_ACTIVITY` | A motion, occupancy or presence sensor changes | `{ active: boolean }` |
| `CONTACT_CHANGED` | A door, window, garage door or opening sensor changes | `{ open: boolean }` |

## Send events to your app

The second list in [`src/config/events.ts`](src/config/events.ts), `webhooks`, decides which events get POSTed to which app:

```ts
{
  name: "cam-quest",
  events: ["ZONE_ACTIVITY"],
  urlEnv: "CAM_QUEST_WEBHOOK_URL",
  secretEnv: "CAM_QUEST_WEBHOOK_SECRET",
},
```

- `events` lists the event types this app gets. A typo here won't compile, because the valid names come from `eventRules`.
- `urlEnv` and `secretEnv` are the *names* of environment variables. The actual URL and secret go in Railway, never in the code.

**To send an event to an app:** add its type to that app's `events` list and push.

**To add a new app:**

1. Add an entry to `webhooks` with its own env var names, like `DASHBOARD_WEBHOOK_URL`.
2. Set those variables in Railway. You can generate a secret with `openssl rand -hex 32`.
3. Push.

If an app's URL variable isn't set, the gateway skips that app, logs `webhook disabled: URL env var not set`, and carries on. Webhook URLs must use `https` (plain `http` is only allowed for `localhost`), and the service won't start if one doesn't.

## Receive events in your app

Each event arrives as a `POST` with a JSON body:

```http
POST /your/webhook/path
Content-Type: application/json
Authorization: Bearer <your webhook secret>
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
| `type` | The event type from `eventRules`. |
| `entityId` | The HA entity that changed. |
| `name` | The entity's friendly name in HA, if it has one. |
| `state` / `previousState` | The new and old HA state. `previousState` is `null` if HA had no earlier state. |
| `timestamp` | When the state changed in HA (ISO 8601). |
| `data` | Extra fields from the rule, if it defines any. |

Your endpoint should:

- **Check the secret** in the `Authorization` header and reject anything that doesn't match.
- **Respond with a 2xx within 5 seconds.** Do slow work after responding.
- **Keep game logic in your app.** The gateway just delivers the facts.

A minimal receiver with Fastify:

```ts
app.post("/ha-events", async (request, reply) => {
  if (request.headers.authorization !== `Bearer ${process.env.HA_GATEWAY_SECRET}`) {
    return reply.code(401).send();
  }

  const event = request.body as { type: string; entityId: string; data?: Record<string, unknown> };
  if (event.type === "ZONE_ACTIVITY") {
    // award XP, start a quest step, etc.
  }

  return reply.code(204).send();
});
```

Heads up, failed deliveries (timeouts or non-2xx responses) are logged as `event consumer failed` but **not retried**. If your app is down, it misses those events.

## Troubleshooting

| What you see | What to do |
| --- | --- |
| `Invalid configuration: HA_URL is required` | Railway isn't passing the variables through. Add them on the service's own **Variables** tab (not only as Shared Variables), then click **Deploy** to apply the staged changes. |
| `/health` shows `auth_failed` | The token is wrong or was deleted in HA. Create a new one, update `HA_TOKEN`, redeploy. |
| Logs repeat `ha connection attempt failed` | Railway can't reach `HA_URL`. Open that URL from your phone on mobile data to check it's public. |
| `ha socket error` with `ENOTFOUND` | Typo in `HA_URL`, or you're using a local address like `homeassistant.local`. |
| An entity changes but no event appears | No rule matches it. Check its device class in HA and compare with `eventRules`. Setting `LOG_LEVEL=debug` shows every raw change the gateway receives. |
| Events are logged but your app gets nothing | Look for `webhook disabled` (URL variable not set) or `event consumer failed` (your endpoint errored or took longer than 5 seconds). |

## Environment variables

| Variable | Required | Description |
| --- | --- | --- |
| `HA_URL` | Yes | Your HA URL, like `https://xxxx.ui.nabu.casa`. A `wss://…/api/websocket` URL works too. |
| `HA_TOKEN` | Yes | HA long-lived access token. Never logged or sent to apps. |
| `CAM_QUEST_WEBHOOK_URL` | No | Where Cam Quest events are POSTed. |
| `CAM_QUEST_WEBHOOK_SECRET` | No | Sent as `Authorization: Bearer …` with those POSTs. |
| `GATEWAY_API_KEY` | No | Key (32+ characters) for the authenticated `/v1` routes. Without it they return 503. |
| `LOG_LEVEL` | No | `info` by default. `debug` also logs raw HA events. |
| `PORT` | No | Railway sets this for you. Defaults to `3000` locally. |
| `HOST` | No | Defaults to `0.0.0.0`. |

The service refuses to start if anything required is missing or invalid, and the error lists every problem at once.

## HTTP API

| Route | Auth | Description |
| --- | --- | --- |
| `GET /health` | None | Service and HA connection status. |
| `GET /v1/status` | `Authorization: Bearer <GATEWAY_API_KEY>` | More detail: HA version, active subscriptions, registered apps. |

Command endpoints (for example, letting an app turn on a light) aren't exposed yet. When they're added, they'll go in the `/v1` scope in [`src/api/server.ts`](src/api/server.ts) so they're protected by the API key, and they'll only allow specific services and entities rather than anything in HA. Inside the gateway, commands already work through the client:

```ts
await homeAssistant.callService({
  domain: "light",
  service: "turn_on",
  target: { entity_id: "light.lounge" },
});
```

## How it works

1. The gateway opens a WebSocket to HA, authenticates with the token and subscribes to `state_changed`.
2. Each change is checked against `eventRules`. Matches become gateway events and everything else is dropped.
3. Every event is logged and POSTed to any app whose `webhooks` entry lists that event type.
4. A ping every 30 seconds catches dead connections. If the connection drops, the gateway reconnects with exponential backoff (1 second, doubling up to 60), then re-subscribes automatically.
5. On shutdown (`SIGTERM` from Railway), it closes the HTTP server and the HA connection cleanly.

```text
src/
├── index.ts              Startup, wiring and shutdown
├── logger.ts             Structured logging (secrets are redacted)
├── config/
│   ├── events.ts         ★ What to listen for and where to send it
│   └── env.ts            Environment variable validation
├── api/                  HTTP server (/health, /v1) and API key auth
├── home-assistant/       Everything HA-specific: connection, subscriptions, commands, rule matching
└── routing/              Event router, webhook delivery and the event shape
```

Scripts: `npm run dev` (local, auto-reloads), `npm run typecheck`, `npm run build` (compiles to `dist/`), `npm start` (runs the build).

If something here is unclear or out of date, open an issue or update this README in the same PR as the change.
