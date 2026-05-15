export function mapSmartDIDVideoRecord(raw) {
  const externalBookId = raw.bookId || raw.book_id;
  const updatedAt = parseDate(raw.updatedAt || raw.updated_at);

  if (!externalBookId) throw new Error('Smart DID record missing bookId');
  if (!updatedAt) throw new Error(`Smart DID record ${externalBookId} missing updatedAt`);

  return {
    externalBookId: String(externalBookId),
    status: raw.status || null,
    requestCount: Number(raw.requestCount ?? raw.request_count ?? 0),
    rankingScore: Number(raw.rankingScore ?? raw.ranking_score ?? 0),
    lastRequestedAt: parseDate(raw.lastRequestedAt || raw.last_requested_at),
    retryCount: Number(raw.retryCount ?? raw.retry_count ?? 0),
    expiresAt: parseDate(raw.expiresAt || raw.expires_at),
    updatedAt,
    raw,
  };
}

export function mapSmartDIDVideoRecords(records) {
  return records.map(mapSmartDIDVideoRecord);
}

export function buildCursorFromRecords(records) {
  if (!records.length) return null;

  const latest = records.reduce((best, record) => {
    if (!best) return record;
    if (record.updatedAt > best.updatedAt) return record;

    if (
      record.updatedAt.getTime() === best.updatedAt.getTime() &&
      record.externalBookId > best.externalBookId
    ) {
      return record;
    }

    return best;
  }, null);

  return {
    cursorUpdatedAt: latest.updatedAt,
    cursorExternalId: latest.externalBookId,
  };
}

function parseDate(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}
