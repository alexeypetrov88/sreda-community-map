# Privacy and threat model

This document describes Sreda 1.0. It is an engineering statement, not a legal
compliance guarantee.

## Intended audience

The product is for a closed community whose administrators vet every member.
Approved membership is a trust decision: every approved member can see the
display name and city-level presence of every other approved member.

## Data minimisation

The application never requests Telegram location permission. A member selects a
city returned by the configured geocoder. The server stores it as a canonical
place and gives the client an opaque place ID. Location writes accept only that
ID, so browser-supplied latitude and longitude cannot be stored.

The map endpoint returns only the member’s chosen display name, city centroid,
country, whether the person is travelling, and the active trip’s date range.
It does not return Telegram usernames.

No phone number, exact address, live GPS trail, private chat history, or
free-form travel note is stored. Members can remove home or permanently delete
their membership, plans, requests, and identifying audit records.

## Trust boundaries

| Actor | Capability |
|---|---|
| Anonymous visitor | Load the public shell; no community data |
| Unknown Telegram user | Cannot request access without the private invitation payload |
| Pending/rejected/revoked user | Receive status messages; no community data |
| Approved member | Read city presence; manage only their own profile, home, and plans |
| Configured admin | Decide requests and revoke/restore members |
| Project/database operator | Access runtime secrets, logs, and raw data |
| Telegram | Process bot messages and provide Mini App identity |
| Hosting provider | Process requests and store application data/logs |
| Geocoder | Receive explicit city search terms |
| Map tile provider | Receive viewer IP and ordinary tile requests |

## Threats and mitigations

### Shared Mini App URL and forged IDs

The root URL is not an access token. Every data API requires fresh
Telegram-signed `initData`; identity always comes from the signed user object,
never a body/query Telegram ID.

### Stolen or replayed init data

HMAC is verified and `auth_date` older than 15 minutes is rejected. Raw
`initData` must never enter logs, analytics, URLs, or error reports.

### Bot discovery and approval abuse

Finding the bot username is insufficient to create a pending account. A new
request requires the random payload in the private Sreda deep link. Rejected
and revoked members cannot reapply until an admin restores them.

Approval callbacks name an expiring request ID and only transition `pending`
once. Admin identity is checked against runtime numeric IDs.

Revocation immediately removes the member’s home and trips as well as their
access. Restoration creates an approved profile with no saved locations.

### Webhook spoofing and retries

The webhook requires a secret header of at least 32 characters. Successfully
processed Telegram update IDs are retained to suppress duplicates. Outbound
message failures do not discard the durable pending request; admins can recover
it from the pending list.

### Unauthorized mutation and race conditions

Display-name changes, home, plans, deletion, and account deletion use the
signed member identity. Plan deletion matches both member and plan IDs. A
SQLite trigger rejects overlap at insertion time even when two requests race.

### Excessive reads and scraping

Authentication, fixed-window member limits, a bounded map horizon, and a
one-year presence range reduce bulk scraping and resource exhaustion. Approved
members remain a meaningful trust boundary: a determined approved member can
inspect community presence across allowed dates.

### Browser compromise and caching

Protected responses are `private, no-store`. The Worker supplies CSP, HSTS,
no-sniff, referrer, permissions, and anti-indexing headers. Leaflet is bundled
with the application rather than loaded as executable third-party code.

## Deliberate 1.0 limitations

- All approved members have equal visibility; there are no per-member controls.
- Retention is an operator policy rather than an automated scheduled job.
- Audit events have no separate web viewer; admins manage membership in the bot.
- There is no automated end-to-end Telegram staging environment.

## Recommended operator policy

Before inviting members, publish who operates the bot, what is stored, who can
see it, retention periods, deletion/correction contact details, and incident
communication procedures.
