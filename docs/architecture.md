# Architecture

## Components

### Telegram webhook

`POST /api/telegram` receives private-chat messages and callback queries. It
rejects requests without the configured Telegram webhook secret header.

`/start` upserts the Telegram identity:

- configured administrators are approved automatically;
- existing approved members receive the Mini App button;
- pending members receive a waiting message;
- new or previously rejected members become pending and notify every
  configured administrator.

Approval callbacks are accepted only from IDs in `SREDA_ADMIN_IDS`. The
allowlist is runtime configuration, not a database role that another member can
grant.

### Mini App authentication

The browser sends Telegram’s raw `initData` in
`X-Telegram-Init-Data`. The server:

1. parses the query string;
2. requires `hash`, `auth_date`, and `user`;
3. rejects stale sessions;
4. derives the HMAC secret from `BOT_TOKEN` and `WebAppData`;
5. compares hashes in constant time;
6. loads the member by the signed Telegram ID;
7. requires `approved` status.

The client-side `initDataUnsafe` object is not used for authorization.

### API routes

| Route | Method | Responsibility |
|---|---|---|
| `/api/me` | GET | Profile, home city and upcoming trips |
| `/api/home` | POST | Set or change the authenticated member’s home |
| `/api/plans` | GET | List the authenticated member’s plans |
| `/api/plans` | POST | Add a non-overlapping trip |
| `/api/plans?id=…` | DELETE | Delete an owned trip |
| `/api/map?date=…` | GET | Presence of approved members on one date |
| `/api/presence` | GET | Members in a city over a date range |
| `/api/geocode?q=…` | GET | Explicit, cached city lookup |
| `/api/telegram` | POST | Telegram webhook |

### Presence rules

- Trip date ranges are inclusive.
- An active trip overrides home for that date.
- Overlapping trips are rejected.
- A member without a home city and without an active trip is absent from the
  map.
- Presence searches show someone if they are in the selected city on at least
  one day of the range.
- Travellers sort before residents.

### Data model

`members`

- Telegram identity and status
- approval timestamps and approving admin ID
- optional home city, country, country code and city-centre coordinates

`plans`

- opaque plan ID
- member ID
- inclusive start/end date
- city, country, country code and city-centre coordinates

`city_search_cache`

- normalized query
- serialized geocoder results
- creation time

## Deliberate constraints

- City-level precision only
- No live tracking
- No overlapping trips
- No user-authored notes
- No LLM
- No public unauthenticated data API
- No client-side source of truth for membership
