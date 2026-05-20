#!/usr/bin/env node

import 'dotenv/config';
import { DidIncrementalSyncService } from '../src/sync/did/incremental-sync.service.js';

async function main() {
  const service = new DidIncrementalSyncService();
  const result = await service.runOnce();

  console.log(JSON.stringify(result, null, 2));
}

main().catch((error) => {
  console.error('[did-sync] manual run failed');
  console.error(error);
  process.exitCode = 1;
});