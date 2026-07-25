# Sreda community map

A closed Telegram bot and Mini App for sharing city-level home locations and
travel plans inside the Sreda community.

## What it does

- new members request access by starting the bot;
- only Telegram numeric IDs in `SREDA_ADMIN_IDS` can approve or reject them;
- approved members set a home city, add current/future trips, and cancel plans;
- the private map distinguishes travellers from people at home at any date;
- city/date search answers “who is here today?” or searches a date range;
- every data endpoint validates Telegram Mini App `initData` and checks approved
  membership server-side.

No exact location, free-form travel notes, natural-language processing, or LLM
is used. City lookup runs only after the member presses **Find**.

## Configure

Create the bot in BotFather and configure these runtime values from
`.env.example`:

- `BOT_TOKEN`
- `SREDA_ADMIN_IDS` — comma-separated Telegram numeric user IDs
- `TELEGRAM_WEBHOOK_SECRET` — a long random value
- `GEOCODER_CONTACT` — an admin email for the geocoder user agent

After deployment, register the webhook:

```bash
curl -X POST "https://api.telegram.org/bot${BOT_TOKEN}/setWebhook" \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://YOUR_DEPLOYED_HOST/api/telegram",
    "secret_token": "YOUR_TELEGRAM_WEBHOOK_SECRET",
    "allowed_updates": ["message", "callback_query"]
  }'
```

Then set the bot’s menu button or Main Mini App URL in BotFather to the deployed
HTTPS root URL.

## Local development

```bash
npm install
npm run db:generate
npm run dev
npm test
```

The public Nominatim service is used only for explicit, cached city searches.
This small-community setup must stay below its one-request-per-second aggregate
limit. Set `GEOCODER_URL` to a hosted provider or self-hosted Nominatim before
the community grows.

## Privacy notes before launch

Tell members that all approved members can see their city-level home and trip
locations. Establish a retention/deletion policy and name the community admin
responsible for data requests. Rotate the bot token and webhook secret if either
is exposed.
