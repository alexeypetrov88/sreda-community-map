# Architecture

## Components

### Telegram webhook

`POST /api/telegram` receives private-chat messages and callback queries. It
requires Telegram’s configured webhook secret and records successfully handled
`update_id` values to make retries idempotent.

`/start <private-code>` creates an expiring membership request:

- configured administrators are approved automatically;
- existing approved members receive the Mini App button;
- pending members receive a waiting message;
- new members must arrive through the private Sreda invitation link;
- rejected, revoked, and blocked members cannot create another request;
- configured administrators receive one-time **Approve** and **Reject**
  callbacks tied to a request record.

Decisions expire after seven days and only transition a current `pending`
request. `/admin` opens button-based pending, active, and inactive member lists.
Admins can revoke or restore access. Hardcoded admin IDs cannot be revoked
through the bot. Revocation clears the member’s home and trips.

### Mini App authentication

The browser sends Telegram’s raw `initData` in `X-Telegram-Init-Data`. The
server:

1. requires a bounded query string containing `hash`, `auth_date`, and `user`;
2. rejects sessions older than 15 minutes or unexpectedly far in the future;
3. derives the HMAC secret from `BOT_TOKEN` and `WebAppData`;
4. compares hashes in constant time;
5. validates and bounds Telegram profile fields;
6. loads the member by the signed Telegram ID;
7. requires current `approved` status.

The client-side `initDataUnsafe` object is not used for authorization.

### API routes

| Route | Method | Responsibility |
|---|---|---|
| `/api/me` | GET | Profile, home city and upcoming trips |
| `/api/me` | PATCH | Update the authenticated member’s display name |
| `/api/me` | DELETE | Permanently delete the member and their trips |
| `/api/home` | POST | Set home using a canonical server place ID |
| `/api/home` | DELETE | Remove the authenticated member’s home |
| `/api/plans` | GET | List the authenticated member’s plans |
| `/api/plans` | POST | Add a canonical-place, non-overlapping trip |
| `/api/plans?id=…` | DELETE | Delete an owned trip |
| `/api/map?date=…` | GET | Minimal presence data for one bounded date |
| `/api/presence` | GET | Members at a canonical place over a date range |
| `/api/geocode?q=…` | GET | Explicit, cached city lookup |
| `/api/telegram` | POST | Telegram webhook |

Every community route authenticates server-side. Protected responses use
`Cache-Control: private, no-store`. General and route-specific D1-backed limits
bound reads, writes, join attempts, and geocoding.

### Presence rules

- Trip ranges are inclusive.
- An active trip overrides home for that date.
- A database trigger rejects overlapping trips atomically.
- A member without home and without an active trip is absent from the map.
- Presence search returns separate contiguous intervals rather than implying
  presence across gaps.
- Travellers sort before residents.

## Data model

`places`

- server-created opaque place ID and normalized canonical key
- geocoder-provided city, country, country code, and centroid

`members`

- bounded Telegram identity fields
- a bounded member-editable display name, initially copied from Telegram
- `pending`, `approved`, `rejected`, `revoked`, or `blocked` status
- approval/status timestamps and approving admin ID
- optional foreign key to a canonical home place

`plans`

- opaque owner-scoped plan ID
- inclusive start/end date
- foreign key to a canonical place

`membership_requests`, `audit_events`, `telegram_updates`, and
`rate_limit_counters` provide expiring decisions, lifecycle accountability,
webhook idempotency, and abuse controls.

`city_search_cache` stores one-way query hashes and public place-result fields
for 90 days. It contains neither the raw search text nor a Telegram ID.

## Deliberate constraints

- City-level precision only; browser-supplied coordinates are never accepted
- No live tracking, exact addresses, or device geolocation
- No overlapping trips
- No user-authored travel notes or LLM
- No public unauthenticated community-data API
- No client-side source of truth for identity or membership
