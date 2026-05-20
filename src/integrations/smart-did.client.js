const DEFAULT_RECORDS_PATH = '/api/video-records';

export class SmartDIDClient {
  constructor({
    baseUrl = process.env.SMART_DID_API_BASE_URL,
    apiToken = process.env.SMART_DID_API_TOKEN,
    recordsPath = process.env.SMART_DID_VIDEO_RECORDS_PATH || DEFAULT_RECORDS_PATH,
    fetchImpl = globalThis.fetch,
    timeoutMs = Number(process.env.DID_SYNC_REQUEST_TIMEOUT_MS || 10000),
  } = {}) {
    if (!baseUrl) throw new Error('SMART_DID_API_BASE_URL is required');
    if (typeof fetchImpl !== 'function') throw new Error('fetch is required');

    this.baseUrl = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
    this.apiToken = apiToken;
    this.recordsPath = recordsPath;
    this.fetchImpl = fetchImpl;
    this.timeoutMs = timeoutMs;
  }

  async fetchUpdatedVideoRecords({
    updatedAfter,
    afterBookId,
    pageToken,
    limit = Number(process.env.DID_SYNC_BATCH_SIZE || 500),
  } = {}) {
    const url = new URL(this.recordsPath, this.baseUrl);
    url.searchParams.set('limit', String(limit));

    if (updatedAfter) url.searchParams.set('updatedAfter', new Date(updatedAfter).toISOString());
    if (afterBookId) url.searchParams.set('afterBookId', afterBookId);
    if (pageToken) url.searchParams.set('pageToken', pageToken);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await this.fetchImpl(url, {
        method: 'GET',
        signal: controller.signal,
        headers: {
          Accept: 'application/json',
          ...(this.apiToken ? { Authorization: `Bearer ${this.apiToken}` } : {}),
        },
      });

      const body = await response.json();

      if (!response.ok) {
        throw new Error(`Smart DID API failed with status ${response.status}`);
      }

      return {
        records: body.records || body.items || body.data || body.videoRecords || [],
        nextPageToken: body.nextPageToken || body.nextCursor || body.cursor || null,
        hasMore: Boolean(body.hasMore || body.nextPageToken || body.nextCursor || body.cursor),
      };
    } finally {
      clearTimeout(timer);
    }
  }
}