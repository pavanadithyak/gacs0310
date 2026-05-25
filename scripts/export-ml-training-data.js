#!/usr/bin/env node

import 'dotenv/config';
import fs from 'fs';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import pool from '../src/db/client.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = {};
  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--start-date': opts.startDate = args[++i]; break;
      case '--end-date':   opts.endDate = args[++i]; break;
      case '--output':     opts.output = args[++i]; break;
      default:
        console.error(`Unknown option: ${args[i]}`);
        process.exit(1);
    }
  }
  return opts;
}

function toISO(d) {
  if (!d) return null;
  try {
    const parsed = new Date(d);
    return isNaN(parsed.getTime()) ? null : parsed.toISOString();
  } catch { return null; }
}

async function main() {
  const opts = parseArgs();

  const now = new Date();
  const ninetyDaysAgo = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);

  const startDate = toISO(opts.startDate) ?? ninetyDaysAgo.toISOString();
  const endDate = toISO(opts.endDate) ?? now.toISOString();
  const output = opts.output || (process.env.TRAINING_DATA_PATH || 'data/training_data.csv');

  const registryPath = join(__dirname, '..', 'src', 'features', 'feature-registry.json');
  let registry;
  try {
    registry = JSON.parse(readFileSync(registryPath, 'utf-8'));
  } catch (err) {
    console.error('[ml-export] Failed to read feature-registry.json:', err.message);
    process.exitCode = 1;
    return;
  }

  const featureNamesOrdered = registry.features.map(f => f.feature_name);

  const { rows } = await pool.query(
    `SELECT
       mf.book_id,
       mf.features,
       mf.computed_at,
       mf.feature_version,
       be.generation_priority_score
     FROM ml_book_features mf
     LEFT JOIN book_did_engagement be ON be.book_id = mf.book_id
     WHERE mf.computed_at >= $1
       AND mf.computed_at <= $2
       AND be.generation_priority_score IS NOT NULL
     ORDER BY mf.computed_at ASC`,
    [startDate, endDate],
  );

  if (rows.length === 0) {
    console.log('No training data found. Run feature computation first (npm run feature:compute).');
    return;
  }

  const header = ['book_id', 'feature_vector', 'generation_priority_score', 'computed_at', 'feature_version'];
  const csvRows = [header.join(',')];

  for (const row of rows) {
    const featureVector = {};
    for (const name of featureNamesOrdered) {
      featureVector[name] = row.features?.[name] ?? null;
    }
    const encoded = Buffer.from(JSON.stringify(featureVector), 'utf-8').toString('base64');
    const label = row.generation_priority_score;
    const computedAt = row.computed_at instanceof Date
      ? row.computed_at.toISOString()
      : String(row.computed_at);
    csvRows.push([
      row.book_id,
      encoded,
      label,
      computedAt,
      row.feature_version,
    ].join(','));
  }

  const outDir = dirname(output);
  if (outDir) {
    fs.mkdirSync(outDir, { recursive: true });
  }
  fs.writeFileSync(output, csvRows.join('\n'), 'utf-8');
  console.log(`Exported ${rows.length} training rows to ${output}`);
}

main()
  .catch((error) => {
    console.error('[ml-export] failed');
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    if (typeof pool.end === 'function') {
      await pool.end();
    }
  });
