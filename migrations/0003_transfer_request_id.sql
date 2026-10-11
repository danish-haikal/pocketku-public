-- PocketKu Step 7.15.10: avoid accidentally duplicating an API transfer.
-- Existing manual test transfers remain valid with NULL request_id.
ALTER TABLE account_ledger ADD COLUMN request_id TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_ledger_request_id
  ON account_ledger(request_id)
  WHERE request_id IS NOT NULL;
