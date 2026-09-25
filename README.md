Telegram bot for Kraken Store — order placement and fulfillment (TF2 keys / gift cards), user verification, and support tickets.

## Setup

```bash
pnpm install
cp .env.example .env
pnpm dev
```

For production:

```bash
pnpm build
pnpm start
```

If `WEBHOOK_URL` in `.env` is empty, the bot runs with long-polling (suitable for development). Otherwise it runs with a webhook (served via Fastify).

## Webhook mode behind Nginx

In webhook mode the bot registers `${WEBHOOK_URL}${WEBHOOK_PATH}` with Telegram on startup and serves it via Fastify on `WEBAPP_HOST:WEBAPP_PORT` (default `127.0.0.1:8443`). Because Fastify only listens locally over plain HTTP, Nginx has to terminate TLS and forward the webhook path to it.

1. Point a domain (e.g. `bot.example.com`) at the server. Telegram only delivers webhooks over HTTPS on ports 443, 80, 88 or 8443.

2. Set the webhook variables in `.env`. `WEBHOOK_URL` is the public base URL **without** the path, because the path is appended from `WEBHOOK_PATH`:

   ```env
   WEBHOOK_URL=https://bot.example.com
   WEBHOOK_PATH=/krakenGSbot
   WEBAPP_HOST=127.0.0.1
   WEBAPP_PORT=8443
   ```

3. Add a server block, e.g. `/etc/nginx/sites-available/kraken-store-bot`:

   ```nginx
   server {
       listen 80;
       server_name bot.example.com;
   }
   ```

   Enable it and get a certificate with Certbot. Certbot adds the `listen 443 ssl` directives and the HTTP→HTTPS redirect:

   ```bash
   sudo ln -s /etc/nginx/sites-available/kraken-store-bot /etc/nginx/sites-enabled/
   sudo apt install certbot python3-certbot-nginx
   sudo certbot --nginx -d bot.example.com
   ```

4. Inside the HTTPS (`listen 443 ssl`) server block, proxy the webhook path to the bot. The `location` must match `WEBHOOK_PATH` exactly:

   ```nginx
   location = /krakenGSbot {
       proxy_pass http://127.0.0.1:8443;
       proxy_http_version 1.1;
       proxy_set_header Host $host;
       proxy_set_header X-Real-IP $remote_addr;
       proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
       proxy_set_header X-Forwarded-Proto $scheme;
   }
   ```

5. Test and reload Nginx, then restart the bot so it re-registers the webhook:

   ```bash
   sudo nginx -t && sudo systemctl reload nginx
   pm2 restart kraken-store-bot
   ```

6. Verify with Telegram (`url` should match, and `last_error_message` should be absent):

   ```bash
   curl "https://api.telegram.org/bot<BOT_TOKEN>/getWebhookInfo"
   ```

Keep `WEBAPP_HOST=127.0.0.1` so the Fastify port is reachable only through Nginx, not directly from the internet.

## Code checks

```bash
pnpm typecheck   # tsc --noEmit
pnpm lint        # eslint .
pnpm format      # biome check --write .
pnpm check       # typecheck + lint
```

## Deployment (PM2)

```bash
sudo npm install -g pm2
pnpm build
pm2 start ecosystem.config.cjs
pm2 startup
pm2 save
pm2 logs kraken-store-bot --lines 30
```
