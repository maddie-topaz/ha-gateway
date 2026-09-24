# ha-gateway

An always-on service that keeps one persistent connection to Home Assistant and acts as a reusable gateway between HA and external applications (Cam Quest, dashboards, and so on).

```text
Home Assistant
      ↕ persistent WebSocket (authenticated with a long-lived token)
ha-gateway (Railway)
      ↕ HTTP (and later WebSocket)
Cam Quest / future apps
```

The gateway understands Home Assistant. It does **not** contain app-specific logic like quests, achievements, inventory or player state. Apps get clean, normalized events and a narrow command API. They never see HA credentials or raw HA payloads.

## Architecture

```text
src/
├── index.ts                  Wiring, startup, graceful shutdown
├── logger.ts                 pino structured logger (with secret redaction)
├── config/env.ts             Env loading + validation (fails closed)
├── api/
│   ├── server.ts             Fastify: GET /health, authenticated /v1 scope
│   └── auth.ts               Bearer API-key hook for app-facing routes
├── home-assistant/           Everything HA-specific lives here
│   ├── connection.ts         WebSocket lifecycle: auth, backoff, heartbeat, id correlation
│   ├── subscriptions.ts      Durable subscription registry, restored on every reconnect
│   ├── commands.ts           callService / getStates (no raw protocol outside this folder)
│   ├── events.ts             state_changed → NormalizedEvent normalizers
│   ├── client.ts             Facade the rest of the app uses
│   └── types.ts              HA protocol types and error classes
└── routing/
    ├── types.ts              NormalizedEvent: the app-facing event contract
    └── event-router.ts       Fans events out to registered consumers
```

Data flow: HA `state_changed` → `toTransition` (drops attribute-only updates and `unavailable`/`unknown`) → normalizers → `EventRouter` → consumers. Events that no normalizer claims are dropped, so raw HA traffic isn't forwarded blindly.

Example: `binary_sensor.hallway_motion` going `off → on` (device class `motion`) becomes:

```json
{
  "type": "ZONE_ACTIVITY",
  "entityId": "binary_sensor.hallway_motion",
  "name": "Hallway Motion",
  "state": "on",
  "previousState": "off",
  "active": true,
  "timestamp": "2026-09-24T11:07:48.797Z"
}
```

Current event types: `ZONE_ACTIVITY` (motion/occupancy/presence) and `CONTACT_CHANGED` (door/window/garage door/opening).

## How the HA connection works

1. Open a WebSocket to `HA_URL` + `/api/websocket`.
2. HA sends `auth_required` and the gateway replies with the token. On `auth_ok` the connection is ready.
3. The subscription registry sends `subscribe_events` for everything registered (currently `state_changed`).
4. A `ping` goes out every 30s. If a ping gets no reply within 10s, the socket is terminated. This catches half-open connections.
5. On any disconnect, in-flight commands are rejected and a reconnect is scheduled with exponential backoff and jitter (1s doubling up to 60s). After `auth_ok` the backoff resets and all subscriptions are restored. HA subscription ids are per-connection, so they're re-created each time.
6. On `auth_invalid` the gateway stops retrying, which avoids tripping HA's IP ban. `/health` then reports `auth_failed`. Fix the token and redeploy.

The process never exits because HA is unreachable. It keeps serving `/health` and keeps retrying.

## Environment variables

| Variable          | Required | Description |
| ----------------- | -------- | ----------- |
| `HA_URL`          | yes      | HA base URL (`https://ha.example.com`) or WebSocket URL (`wss://…/api/websocket`). Must be reachable from Railway. |
| `HA_TOKEN`        | yes      | Long-lived access token (HA → Profile → Security). Never logged or exposed. |
| `GATEWAY_API_KEY` | no       | Secret (≥32 chars) that apps send as `Authorization: Bearer …` for `/v1/*`. If unset, `/v1/*` returns 503. |
| `PORT`            | no       | HTTP port. Railway sets this automatically. Defaults to `3000`. |
| `HOST`            | no       | Bind address. Defaults to `0.0.0.0`. |
| `LOG_LEVEL`       | no       | `fatal`, `error`, `warn`, `info` (default), `debug` or `trace`. `debug` also logs raw HA events. |

The service refuses to start if a required variable is missing or invalid.

## Local development

```bash
cp .env.example .env   # then fill in HA_URL and HA_TOKEN
npm install
npm run dev            # tsx watch; loads .env automatically
curl localhost:3000/health
```

Other scripts: `npm run typecheck`, `npm run build` (tsc → `dist/`), `npm start` (runs `dist/index.js`).

## Railway deployment

`railway.json` configures everything below. It uses Railway's standard Node builder, not Docker.

- **Build command:** `npm run build`
- **Start command:** `node dist/index.js`. This runs node directly rather than `npm start`, so `SIGTERM` reaches the process.
- **Health check path:** `/health`
- **Restart policy:** always

Set `HA_URL`, `HA_TOKEN` and (optionally) `GATEWAY_API_KEY` in the service's Variables. HA must be reachable from the public internet, for example through Nabu Casa or a Cloudflare Tunnel. Use `https://`/`wss://` so the token is encrypted in transit.

`/health` always returns 200 while the process is serving. It reports `"status": "degraded"` when HA is disconnected. That way an HA outage doesn't fail deploys or cause restarts that wouldn't help. For alerting on HA connectivity, watch the `homeAssistant` field.

```json
{ "status": "ok", "homeAssistant": "connected", "uptimeSeconds": 1234 }
```

## HTTP API

| Route            | Auth   | Description |
| ---------------- | ------ | ----------- |
| `GET /health`    | none   | Liveness + HA connection state |
| `GET /v1/status` | bearer | Detailed state: HA version, subscriptions, consumers |

## Integrating a new application

**Consuming events.** Register a consumer with the router in `src/index.ts`:

```ts
router.register({
  name: "cam-quest",
  accepts: (event) => event.type === "ZONE_ACTIVITY",
  handle: async (event) => { /* forward to Cam Quest over HTTP/WebSocket */ },
});
```

Consumers are isolated from each other: one that throws or rejects is logged and doesn't affect the rest. Keep app logic in the app. The consumer should only deliver events.

**New event types.** Add a variant to `NormalizedEvent` in `src/routing/types.ts`, write a `Normalizer` in `src/home-assistant/events.ts`, and add it to `defaultNormalizers`.

**Sending commands.** Use the client instead of raw protocol messages:

```ts
await homeAssistant.callService({
  domain: "light",
  service: "turn_on",
  target: { entity_id: "light.lounge" },
});
```

To expose a command to apps, add a route inside the `/v1` scope in `src/api/server.ts` so it inherits authentication. Allowlist the specific domains, services and entities an app may use. Don't proxy arbitrary service calls.
