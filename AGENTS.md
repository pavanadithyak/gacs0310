---

## Incremental Sync Standards (Task 1.3)

### Core Principle
The 15-minute Smart DID incremental sync is a safety net for missed or delayed webhook events. It must reuse the same data ownership rules as the webhook system.

Smart DID may update engagement and playback state, but it must not overwrite canonical GACS book metadata.

### File Naming
- `src/integrations/smart-did.client.js` — Smart DID API client
- `src/sync/did/did-sync.mapper.js` — converts Smart DID payloads into GACS sync records
- `src/sync/did/did-sync.repository.js` — PostgreSQL reads/writes for DID sync
- `src/sync/did/incremental-sync.service.js` — one complete incremental sync run
- `src/sync/did/incremental-sync.worker.js` — BullMQ worker
- `src/sync/did/incremental-sync.scheduler.js` — repeatable 15-minute job registration
- `scripts/run-did-incremental-sync.js` — manual one-shot sync runner

### Runtime
- Runtime: Node.js ESM modules
- Queue: BullMQ
- Cache/Queue Backend: Redis
- DB: PostgreSQL via `pg`
- Manual command: `npm run sync:did`
- Worker command: `npm run worker:did-sync`

### Cursor Strategy
- Cursor table: `did_sync_state`
- Cursor key: `smart_did.video_records`
- Cursor fields:
  - `cursor_updated_at`
  - `cursor_external_id`
- Query Smart DID using:
  - `updatedAfter`
  - `afterBookId`
  - `limit`
  - `pageToken`, if available

### Safety Window
Use a small lookback window when fetching records.

Default:

```env
DID_SYNC_LOOKBACK_SECONDS=120