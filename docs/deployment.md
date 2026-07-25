# Deployment and Telegram setup

## 1. Create credentials

Create the Sreda Community Map bot through
[BotFather](https://t.me/BotFather). Administrators may be configured using
numeric Telegram IDs or usernames. Each configured username can be claimed
once by the matching account; that account's numeric Telegram identity is then
pinned in the database and becomes authoritative for later admin checks.

Generate three different random values:

- the BotFather token;
- a URL-safe Sreda join code of 16–64 characters;
- a Telegram webhook secret of at least 32 characters.

Do not put real values in GitHub, screenshots, command history, or
`.env.example`.

## 2. Provision storage

The Worker expects a D1 binding named `DB`. Apply every migration in `drizzle/`
in order. For Sites, `.openai/hosting.json` declares the logical binding and
packaged migrations are applied during deployment.

Migration `0001` preserves pre-1.0 home/trip data by converting each existing
location to a server-owned legacy place, adds membership lifecycle tables, and
creates the atomic overlap trigger.

## 3. Configure runtime values

```text
BOT_TOKEN
SREDA_ADMIN_IDS
SREDA_ADMIN_USERNAMES
SREDA_APP_URL
SREDA_JOIN_CODE
TELEGRAM_WEBHOOK_SECRET
GEOCODER_CONTACT
```

`SREDA_APP_URL` is the canonical HTTPS root used in Telegram buttons.
`GEOCODER_URL` optionally replaces the Nominatim-compatible default.

Store `BOT_TOKEN`, `SREDA_JOIN_CODE`, and `TELEGRAM_WEBHOOK_SECRET` as hosting
secrets. Configure at least one of `SREDA_ADMIN_IDS` or
`SREDA_ADMIN_USERNAMES`, and treat the admin allowlist as security-sensitive
configuration.

## 4. Validate and deploy

```bash
npm ci
npm run lint
npm run typecheck
npm test
npm run audit:prod
```

Deploy the exact tested source and its migrations.

## 5. Register Telegram

Register `https://YOUR_HOST/api/telegram` using `setWebhook`, the configured
secret token, `message` and `callback_query` allowed updates, and
`drop_pending_updates: true`. Never paste a URL containing the bot token into a
public issue or log.

Configure the root URL as the bot’s Main Mini App. Distribute this link only
inside Sreda:

```text
https://t.me/YOUR_BOT_USERNAME?start=YOUR_SREDA_JOIN_CODE
```

Finding the bot without this payload creates no member or request. Rotate the
code and redistribute the link if it escapes the community.

Admins can use `/admin` to open the button-based membership menu.

## 6. Acceptance test

Use separate synthetic admin and member accounts:

1. Starting without the join payload creates no pending account.
2. The private link creates one pending, expiring request.
3. Pending and forged sessions cannot read any API.
4. A non-admin callback cannot decide the request.
5. Approval grants map access.
6. A selected city can be saved as home; arbitrary coordinates are rejected.
7. Current and future trips affect the correct dates.
8. A concurrent or ordinary overlapping plan is rejected.
9. Presence results split non-contiguous intervals.
10. Plan cancellation is owner-scoped.
11. Revocation immediately returns `403` on subsequent data requests.
12. Restoration returns access.
13. Self-service deletion removes the member and cascading plans.
14. Static/browser-only visits reveal no community data.

## 7. Operations

- Monitor errors without recording request authorization headers.
- Review dependency alerts and run the production audit before releases.
- Back up/export D1 according to the published retention policy.
- Periodically review admin and approved-member lists.
- Rotate all affected secrets after suspected disclosure.
