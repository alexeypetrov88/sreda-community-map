# Changelog

## 1.0.0

- Require a private Telegram deep-link join code before admin approval.
- Add expiring, one-time approval requests and button-based member management.
- Add immediate revocation/restoration; revocation clears saved locations.
- Enforce server-owned canonical cities instead of accepting client coordinates.
- Add authenticated request limits, webhook idempotency, and membership audits.
- Add private no-store responses and application security headers.
- Add self-service home removal and permanent account-data deletion.
- Enforce trip overlap atomically in D1 and preserve valid pre-1.0 data.
- Bundle Leaflet locally and minimize map/presence API responses.
- Add Telegram signature, state-machine, input-boundary, migration, and
  protected-route tests.
- Upgrade the runtime dependency set and clear the production audit.
