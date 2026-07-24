ربات تلگرامی فروشگاه کراکن — ثبت و تحویل سفارش (کلید TF2 / گیفت کارت)، احراز هویت کاربران، و تیکت پشتیبانی.

## راه‌اندازی

```bash
pnpm install
cp .env.example .env
pnpm dev
```

برای پروداکشن:

```bash
pnpm build
pnpm start
```

اگر `WEBHOOK_URL` در `.env` خالی باشد، ربات با long-polling اجرا می‌شود (مناسب توسعه). در غیر این صورت با webhook (از طریق Fastify) اجرا می‌شود.

## بررسی کد

```bash
pnpm typecheck   # tsc --noEmit
pnpm lint        # eslint .
pnpm format      # biome check --write .
pnpm check       # typecheck + lint
```

## دیپلوی (PM2)

```bash
sudo npm install -g pm2
pnpm build
pm2 start ecosystem.config.cjs
pm2 startup
pm2 save
pm2 logs kraken-store-bot --lines 30
```