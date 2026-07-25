# Deployment and Telegram setup

## 1. Create the bot

Open [BotFather](https://t.me/BotFather), run `/newbot`, and save the token in a
secret manager. Do not put it in `.env.example`, GitHub Actions logs, issues, or
screenshots.

Collect the numeric Telegram user IDs of each administrator. Usernames are
mutable and are not suitable for authorization.

Generate a long random webhook secret using a password manager or cryptographic
random generator.

## 2. Provision storage

The Worker expects a D1 binding named `DB`. Apply every migration in `drizzle/`
in order. The deployment must fail closed if the database or migration is
missing.

For ChatGPT Sites, `.openai/hosting.json` declares the logical `DB` binding and
Sites applies packaged migrations during deployment.

For a direct Cloudflare deployment, create your own D1 database, replace the
placeholder database ID in the generated Worker configuration, and apply the
migration with Wrangler before deploying.

## 3. Configure runtime values

Set:

```text
BOT_TOKEN
SREDA_ADMIN_IDS
TELEGRAM_WEBHOOK_SECRET
GEOCODER_CONTACT
```

Optionally set `GEOCODER_URL` to another Nominatim-compatible search endpoint.

`BOT_TOKEN` and `TELEGRAM_WEBHOOK_SECRET` are secrets.
`SREDA_ADMIN_IDS` is security-sensitive configuration even though Telegram IDs
are not authentication credentials.

## 4. Deploy HTTPS application

Build and validate:

```bash
npm ci
npm run lint
npx tsc --noEmit
npm test
```

Deploy the exact tested commit. The root URL must be accessible from Telegram.
Community APIs remain protected by Telegram signature and membership checks.

## 5. Register the webhook

Replace the placeholders locally:

```bash
curl -X POST "https://api.telegram.org/bot${BOT_TOKEN}/setWebhook" \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://YOUR_HOST/api/telegram",
    "secret_token": "YOUR_TELEGRAM_WEBHOOK_SECRET",
    "allowed_updates": ["message", "callback_query"],
    "drop_pending_updates": true
  }'
```

Verify:

```bash
curl "https://api.telegram.org/bot${BOT_TOKEN}/getWebhookInfo"
```

Never paste command output containing the token into a public issue.

## 6. Configure the Mini App

In BotFather, configure the bot’s **Main Mini App** or menu button to the HTTPS
root URL. The server supplies the same URL in the approval message’s
`web_app` button.

## 7. Acceptance test

Use at least two distinct Telegram accounts: one configured admin and one
ordinary member.

1. Ordinary member starts the bot.
2. Member sees a pending response and cannot open data.
3. Admin receives the request and approves it.
4. Member receives the Mini App button.
5. Member sets a home city.
6. Map shows the member at home.
7. Member creates a current trip; map colour and city change today.
8. A future date outside the trip returns the member home.
9. Member adds a future trip.
10. An overlapping plan is rejected.
11. **Who is here today?** returns the expected member.
12. Member cancels a plan with two button presses.
13. A non-Telegram browser sees only the locked shell.
14. A forged or missing `initData` API request returns `401`.
15. A valid but unapproved user returns `403`.

After testing, delete synthetic test accounts or document why they remain.

## 8. Operational checks

- Turn on hosting error monitoring.
- Review dependency alerts.
- Back up or export the database according to the retention policy.
- Rotate secrets after any accidental disclosure.
- Periodically review the admin allowlist and approved membership.
