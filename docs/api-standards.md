# API Standards (Sprint 2+)

## Route Naming Convention

Verbs are expressed as HTTP methods; paths represent resources:

```
GET    /api/predictions/:bookId   # Fetch prediction for a book
POST   /api/inference/trigger     # Trigger inference (admin)
GET    /api/metrics/drift         # A/B experiment dashboard
```

## Auth Pattern

Admin actions use X-API-Key header authentication:

```javascript
app.post('/api/inference/trigger', apiKeyAuth, controller.trigger);
```

The `apiKeyAuth` middleware (in `src/middleware/api-key-auth.js`) reads the `X-API-Key` header and compares it to `process.env.INFERENCE_API_KEY`. Non-admin endpoints are unauthenticated.

## Response Format

### Success
```json
{ "status": "ok", "data": { ... } }
```

### Error
```json
{ "status": "error", "error": "message" }
```

### Auth Error (401)
```json
{ "status": "error", "error": "Unauthorized" }
```

### Not Found (404)
```json
{ "status": "error", "error": "Not found" }
```

## Morgan Logging

All requests are logged via Morgan middleware with the `combined` format:

```
:remote-addr - :remote-user [:date[clf]] ":method :url HTTP/:http-version" :status :res[content-length] ":referrer" ":user-agent"
```

### Redaction Rules
- `Authorization` headers: automatically redacted by Morgan
- Book IDs: logged in predictions API path, not in response body
- API keys: never logged (header only, no body)

## Middleware Order (app.js)

```javascript
app.use(morgan('combined'));                 // Logging first
app.use('/webhooks', express.raw({ type: 'application/json' }), webhookRouter);  // Webhooks with raw body
app.use(express.json());                     // JSON parsing for API routes
app.use('/api', apiRouter);                  // REST APIs
```

## Barrel Exports

API routers are exported via `src/api/index.js`:

```javascript
export { default as inferenceRouter } from './inference-routes.js';
export { default as metricsRouter } from './metrics-routes.js';
```

Used by `app.js`:
```javascript
import { inferenceRouter, metricsRouter } from './api/index.js';
```

## File Structure

```
src/
  api/
    index.js              # Barrel exports
    inference-routes.js   # GET /predictions/:bookId + POST /inference/trigger
    metrics-routes.js     # GET /metrics/drift
  middleware/
    api-key-auth.js       # X-API-Key authentication
```
