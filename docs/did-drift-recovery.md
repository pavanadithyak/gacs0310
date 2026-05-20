# Smart DID Drift Recovery Sync

The 15-minute Smart DID sync is a recovery system.

Smart DID webhooks are lightweight. They only tell GACS that something changed for a book.

GACS then pulls full canonical data from:

```text
GET /api/integration/books/{bookId}/full