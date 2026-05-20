import crypto from 'node:crypto';

export class DriftDetector {
  normalize(raw) {
    if (!raw || typeof raw !== 'object') {
      throw new Error('Smart DID full book payload must be an object');
    }

    const externalBookId = raw.bookId || raw.book_id || raw.id;
    if (!externalBookId) throw new Error('Smart DID payload missing bookId');

    const normalized = {
      externalBookId: String(externalBookId),
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
      fingerprint: this.fingerprint(normalized),
    };
  }

  fingerprint(normalized) {
    const payload = {
      externalBookId: normalized.externalBookId,
      metadata: normalized.metadata,
      engagement: normalized.engagement,
      video: normalized.video,
      scenePlans: normalized.scenePlans,
      prompts: normalized.prompts,
      subtitles: normalized.subtitles,
      mediaAssets: normalized.mediaAssets,
      sourceUpdatedAt: normalized.sourceUpdatedAt?.toISOString?.() ?? null,
    };

    return crypto
      .createHash('sha256')
      .update(stableStringify(payload))
      .digest('hex');
  }

  detect({ canonicalBook, storedFingerprint }) {
    return {
      hasDrift: storedFingerprint !== canonicalBook.fingerprint,
      previousFingerprint: storedFingerprint,
      newFingerprint: canonicalBook.fingerprint,
    };
  }
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
    return Object.keys(value).sort().reduce((acc, key) => {
      acc[key] = sortKeys(value[key]);
      return acc;
    }, {});
  }

  return value;
}