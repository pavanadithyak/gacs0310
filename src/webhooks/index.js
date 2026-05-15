import express from 'express';
import * as handler from './did.handler.js';

const router = express.Router();

// Mount the webhook handler
router.post('/did', handler.handleWebhook);

export default router;
