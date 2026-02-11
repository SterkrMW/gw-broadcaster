# Guild War Broadcast Viewer

Production-oriented React/Vite viewer for Guild War match and bracket state.

## One-Box Production (Recommended)

One host runs:
- static frontend files (`dist`) served by Caddy
- broadcast token + websocket server (`server.ts`) on `127.0.0.1:8081`

Public traffic hits only Caddy on `443`.

### 1) Build artifacts

```bash
npm ci
npm run build:prod
```

- frontend output: `dist`
- server output: `server-dist/server/server.js`

### 2) Production config

Use `server/server.config.production.example.json` as template and save real config to `server/server.config.json`:

- `host`: `127.0.0.1` (internal only; Caddy proxies to it)
- `allowedOrigins`: exact public viewer origin(s), e.g. `https://viewer.example.com`
- `allowSameHostDifferentPort`: `false`
- `trustProxy`: `true` (required behind reverse proxy so per-IP limits use real client IP)

### 3) Reverse proxy (Caddy)

Use `ops/one-box/Caddyfile.example`:
- serves static SPA from `/var/www/gw-broadcast-viewer/dist`
- proxies `/session-token` to `127.0.0.1:8081`
- proxies `/ws` to `127.0.0.1:8081`

Build with:

```bash
VITE_WS_URL=wss://viewer.example.com/ws npm run build
```

Copy `dist` to Caddy `root` path.

### 4) Server process manager

Use `ops/one-box/gw-broadcast-server.service.example` as a systemd service template.

Recommended layout:
- app path: `/opt/gw-broadcast-viewer`
- static files: `/var/www/gw-broadcast-viewer/dist`

### 5) Firewall / network

- open inbound `443` only
- keep `8081` local-only (bound to `127.0.0.1`)

### 6) Health checks

- `https://viewer.example.com` serves app
- `https://viewer.example.com/session-token` returns JSON in browser
- websocket connects at `wss://viewer.example.com/ws?sessionToken=...`
- no reconnect loops or CORS/origin rejections in logs

## LAN Dev Quick Start

1. `npm run server`
2. `npm run dev`
3. Open `http://<host-lan-ip>:5173`

`vite.config.ts` binds host/port for LAN dev.

## Canonical Connection URL

- If `VITE_WS_URL` is unset, client auto-targets page host on port `8081`.
- For production behind Caddy path routing, set `VITE_WS_URL` to canonical secure endpoint (e.g. `wss://viewer.example.com/ws`) at build time.
