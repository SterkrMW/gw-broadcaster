# One-Box Install Guide (Ubuntu)

This guide deploys the viewer and broadcast server on a single Ubuntu host with:
- Caddy serving HTTPS
- static frontend files from `dist`
- Node broadcast server behind Caddy on `127.0.0.1:8081`

## 0) Assumptions

- Domain: `viewer.example.com`
- Server user with sudo access
- DNS `A` record points to this host
- Repo checked out at `/opt/gw-broadcast-viewer`
- Broadcast state file available at `/opt/gw-broadcast-viewer/data/broadcast-state.json`

## 1) Install system dependencies

```bash
sudo apt update
sudo apt install -y curl gnupg ca-certificates git
```

Install Node.js 20+ (example via NodeSource):

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
node -v
npm -v
```

Install Caddy:

```bash
sudo apt install -y debian-keyring debian-archive-keyring apt-transport-https
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | sudo tee /etc/apt/sources.list.d/caddy-stable.list
sudo apt update
sudo apt install -y caddy
```

## 2) Build app artifacts

```bash
cd /opt/gw-broadcast-viewer/gw-broadcast-viewer
npm ci
VITE_WS_URL=wss://viewer.example.com/ws npm run build:prod
```

## 3) Prepare server config

Copy production template:

```bash
cp server/server.config.production.example.json server/server.config.json
```

Edit `server/server.config.json`:
- `allowedOrigins`: set to `https://viewer.example.com`
- `stateFilePath`: verify location
- `trustProxy`: keep `true` (Caddy is in front)
- keep `host` as `127.0.0.1`

## 4) Install static files

```bash
sudo mkdir -p /var/www/gw-broadcast-viewer
sudo rsync -av --delete dist/ /var/www/gw-broadcast-viewer/dist/
sudo chown -R www-data:www-data /var/www/gw-broadcast-viewer
```

## 5) Configure Caddy

Copy and edit Caddy config:

```bash
sudo cp ops/one-box/Caddyfile.example /etc/caddy/Caddyfile
sudo nano /etc/caddy/Caddyfile
```

Replace:
- `viewer.example.com` with your domain
- `/var/www/gw-broadcast-viewer/dist` path if needed

Validate and reload:

```bash
sudo caddy validate --config /etc/caddy/Caddyfile
sudo systemctl reload caddy
sudo systemctl status caddy --no-pager
```

Important:
- Ensure `/session-token` and `/ws*` use `handle` (not `handle_path`) in Caddy.
- `handle_path` strips the path prefix, which causes `/session-token` to proxy as `/` and break JSON session bootstrap.
- Keep API/websocket handlers inside a `route { ... }` block before SPA fallback, so `/session-token` cannot be rewritten to `/index.html`.

## 6) Configure systemd service for broadcast server

```bash
sudo cp ops/one-box/gw-broadcast-server.service.example /etc/systemd/system/gw-broadcast-server.service
sudo nano /etc/systemd/system/gw-broadcast-server.service
```

Confirm `WorkingDirectory` points to:
- `/opt/gw-broadcast-viewer/gw-broadcast-viewer`

Enable and start:

```bash
sudo systemctl daemon-reload
sudo systemctl enable gw-broadcast-server
sudo systemctl restart gw-broadcast-server
sudo systemctl status gw-broadcast-server --no-pager
```

View logs:

```bash
journalctl -u gw-broadcast-server -f
```

## 7) Firewall

Expose only web ports:

```bash
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw enable
sudo ufw status
```

Do not expose `8081`; it is bound to localhost.

## 8) Verification checklist

From browser:
- `https://viewer.example.com` loads app
- `https://viewer.example.com/session-token` returns JSON
- websocket connects via `wss://viewer.example.com/ws`
- no CORS or mixed-content errors in browser console

From server:
- `sudo systemctl status caddy`
- `sudo systemctl status gw-broadcast-server`
- `journalctl -u gw-broadcast-server -n 100 --no-pager`

## 9) Update procedure

```bash
cd /opt/gw-broadcast-viewer
git pull
cd gw-broadcast-viewer
npm ci
VITE_WS_URL=wss://viewer.example.com/ws npm run build:prod
sudo rsync -av --delete dist/ /var/www/gw-broadcast-viewer/dist/
sudo systemctl restart gw-broadcast-server
sudo systemctl reload caddy
```

## 10) Rollback quick path

Keep prior deploy tarballs for `dist` and `server-dist`.
If needed:
- restore previous `dist` into `/var/www/gw-broadcast-viewer/dist`
- restore previous `server-dist`
- `sudo systemctl restart gw-broadcast-server`
- `sudo systemctl reload caddy`
