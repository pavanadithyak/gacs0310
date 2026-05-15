REVOKE ALL ON did_sync_state FROM gacs_user;
DROP INDEX IF EXISTS idx_did_sync_state_last_success_at;
DROP TABLE IF EXISTS did_sync_state CASCADE;
