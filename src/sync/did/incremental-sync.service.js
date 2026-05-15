import { SmartDIDClient } from '../../integrations/smart-did.client.js';
import {
  mapSmartDIDVideoRecords,
  buildCursorFromRecords,
} from './did-sync.mapper.js';
import { DidSyncRepository } from './did-sync.repository.js';

export class DidIncrementalSyncService {
  constructor({
    client = new SmartDIDClient(),
    repository = new DidSyncRepository(),
    batchSize = Number(process.env.DID_SYNC_BATCH_SIZE || 500),
    lookbackSeconds = Number(process.env.DID_SYNC_LOOKBACK_SECONDS || 120),
    maxPages = Number(process.env.DID_SYNC_MAX_PAGES || 20),
  } = {}) {
    this.client = client;
    this.repository = repository;
    this.batchSize = batchSize;
    this.lookbackSeconds = lookbackSeconds;
    this.maxPages = maxPages;
  }

  async runOnce() {
    await this.repository.markStarted();

    try {
      const cursor = await this.repository.getCursor();
      const updatedAfter = cursor?.cursor_updated_at
        ? new Date(new Date(cursor.cursor_updated_at).getTime() - this.lookbackSeconds * 1000)
        : null;

      let pageToken = null;
      let afterBookId = cursor?.cursor_external_id || null;
      let hasMore = true;
      let pages = 0;

      const total = {
        status: 'success',
        pages: 0,
        fetched: 0,
        insertedOrUpdated: 0,
        unchanged: 0,
        skipped: 0,
        failed: 0,
      };

      while (hasMore && pages < this.maxPages) {
        const page = await this.client.fetchUpdatedVideoRecords({
          updatedAfter,
          afterBookId,
          pageToken,
          limit: this.batchSize,
        });

        const records = mapSmartDIDVideoRecords(page.records);
        const nextCursor = buildCursorFromRecords(records);
        const summary = await this.repository.applyBatch(records, nextCursor);

        pages += 1;
        total.pages = pages;
        total.fetched += records.length;
        total.insertedOrUpdated += summary.insertedOrUpdated;
        total.unchanged += summary.unchanged;
        total.skipped += summary.skipped;
        total.failed += summary.failed;

        if (nextCursor) afterBookId = nextCursor.cursorExternalId;

        pageToken = page.nextPageToken;
        hasMore = Boolean(page.hasMore && records.length > 0);
      }

      if (hasMore) {
        total.status = 'partial';
        total.reason = 'max_pages_reached';
      }

      return total;
    } catch (error) {
      await this.repository.markFailed(error);
      throw error;
    }
  }
}
