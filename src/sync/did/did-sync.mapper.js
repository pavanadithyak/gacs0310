import crypto from 'node:crypto';

export function normalizeFullBookPayload(raw) {
  if (!raw || typeof raw !== 'object') {
    throw new Error('Smart DID full book payload must be an object');
  }

  const bookId = raw.bookId || raw.book_id || raw.id;

  if (!bookId) {
    throw new Error('Smart DID full book payload missing bookId');
  }

  const normalized = {
    externalBookId: String(bookId),

    metadata: {
      title: raw.title ?? raw.metadata?.title ?? null,
      author: raw.author ?? raw.metadata?.author ?? null,
      publisher: raw.publisher ?? raw.metadata?.publisher ?? null,
      isbn: raw.isbn ?? raw.metadata?.isbn ?? null,
      summary: raw.summary ?? raw.metadata?.summary ?? null,
      category: raw.category ?? raw.metadata?.category ?? null,
      coverImageUrl: raw.coverImageUrl ?? raw.metadata?.coverImageUrl ?? null,
    },

    engagement: {
      requestCount: Number(raw.requestCount ?? raw.engagement?.requestCount ?? 0),
      rankingScore: Number(raw.rankingScore ?? raw.engagement?.rankingScore ?? 0),
      lastRequestedAt: parseDate(raw.lastRequestedAt ?? raw.engagement?.lastRequestedAt),
      retryCount: Number(raw.retryCount ?? raw.engagement?.retryCount ?? 0),
    },

    video: {
      status: raw.status ?? raw.video?.status ?? null,
      videoUrl: raw.videoUrl ?? raw.video?.videoUrl ?? null,
      subtitleUrl: raw.subtitleUrl ?? raw.video?.subtitleUrl ?? null,
      expiresAt: parseDate(raw.expiresAt ?? raw.video?.expiresAt),
      errorMessage: raw.errorMessage ?? raw.video?.errorMessage ?? null,
    },

    scenePlans: raw.scenePlans ?? raw.scene_plans ?? [],
    prompts: raw.prompts ?? [],
    subtitles: raw.subtitles ?? [],
    mediaAssets: raw.mediaAssets ?? raw.media_assets ?? [],

    sourceUpdatedAt: parseDate(raw.updatedAt ?? raw.updated_at),
    raw,
  };

  return {
    ...normalized,
    fingerprint: buildFingerprint(normalized),
  };
}

export function buildFingerprint(normalizedPayload) {
  const stablePayload = {
    externalBookId: normalizedPayload.externalBookId,
    metadata: normalizedPayload.metadata,
    engagement: normalizedPayload.engagement,
    video: normalizedPayload.video,
    scenePlans: normalizedPayload.scenePlans,
    prompts: normalizedPayload.prompts,
    subtitles: normalizedPayload.subtitles,
    mediaAssets: normalizedPayload.mediaAssets,
    sourceUpdatedAt: normalizedPayload.sourceUpdatedAt?.toISOString?.() ?? null,
  };

  return crypto
    .createHash('sha256')
    .update(stableStringify(stablePayload))
    .digest('hex');
}

function parseDate(value) {
  if (!value) return null;

  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function stableStringify(value) {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(value) {
  if (Array.isArray(value)) return value.map(sortKeys);

  if (value && typeof value === 'object' && !(value instanceof Date)) {
    return Object.keys(value)
      .sort()
      .reduce((acc, key) => {
        acc[key] = sortKeys(value[key]);
        return acc;
      }, {});
  }

  return value;
}
