# Privacy and threat model

This document describes the current MVP, not a legal compliance guarantee.

## Intended audience

The product is for a closed community whose administrators vet every member.
Approved membership is a trust decision: every approved member can see the
display name and city-level presence of every other approved member.

## Data minimisation

The application does not request Telegram’s location-sharing permission. A
member selects a city returned by the configured geocoder. Stored latitude and
longitude therefore represent a city centroid rather than a device position.

No phone number, exact address, live GPS trail, private chat history, or
free-form travel note is stored.

## Trust boundaries

| Actor | Capability |
|---|---|
| Anonymous visitor | Load public static shell; no community data |
| Pending/rejected Telegram user | Receive status messages; no community data |
| Approved member | Read approved-member presence; manage own home and plans |
| Configured admin | Approve/reject requests; member powers when approved |
| Project/database operator | Access runtime configuration, logs and raw data |
| Telegram | Process bot messages and provide Mini App identity |
| Hosting provider | Process requests and store application data/logs |
| Geocoder | Receive explicit city search terms |
| Map tile provider | Receive ordinary tile requests from the viewer |

## Threats considered

### Shared Mini App URL

The root URL is not an access token. APIs require valid Telegram-signed
`initData` and approved membership.

### Forged Telegram ID

The server derives identity from signed `initData`, never from a request-body
ID.

### Stolen or replayed init data

The HMAC is validated and old `auth_date` values are rejected. Operators should
keep the accepted age short enough for their risk tolerance.

### Unauthorized plan deletion

Deletion matches both the opaque plan ID and authenticated Telegram ID.

### Fake admin callback

Admin callback IDs are checked against the runtime allowlist on the server.

### Telegram webhook spoofing

The webhook requires Telegram’s configured secret-token header.

### Accidental precision increase

Location writes accept only structured place objects. UI and geocoder results
must remain city-level; contributors should not add device geolocation.

## Known gaps before a broad launch

- No self-service account/data deletion
- No visibility controls between approved members
- No formal audit-event table
- No automated abuse/rate limiter beyond upstream hosting limits
- No operator UI for suspending an approved member
- No automated data-retention process
- No end-to-end Telegram staging environment

## Recommended operator policy

Before inviting members, publish:

- who operates the bot;
- what is stored;
- who can see it;
- how long inactive plans and accounts are retained;
- how to request correction or deletion;
- how security incidents will be communicated.
