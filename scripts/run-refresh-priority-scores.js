#!/usr/bin/env node

import 'dotenv/config';
import db from '../src/db/client.js';

async function main() {
  const result = await db.query('SELECT * FROM refresh_priority_scores();');
  const rowsUpdated = result.rows[0]?.rows_updated ?? 0;

  console.log(
    JSON.stringify(
      {
        status: 'ok',
        rowsUpdated,
        refreshedAt: new Date().toISOString(),
      },
      null,
      2,
    ),
  );
}

main()
  .catch((error) => {
    console.error('[priority] refresh failed');
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    if (typeof db.end === 'function') {
      await db.end();
    }
  });