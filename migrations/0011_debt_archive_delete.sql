-- Step 7.28: archive a debt without deleting its payment history.
-- Only unlinked debts with no payments can be permanently deleted.
ALTER TABLE debts ADD COLUMN archived_at TEXT DEFAULT NULL;
CREATE INDEX IF NOT EXISTS idx_debts_archived ON debts(archived_at,id);

CREATE TRIGGER IF NOT EXISTS debt_prevent_unsafe_delete
BEFORE DELETE ON debts
BEGIN
  SELECT RAISE(ABORT, 'Cannot delete a debt with repayments')
    WHERE EXISTS(SELECT 1 FROM debt_payments WHERE debt_id=OLD.id);
  SELECT RAISE(ABORT, 'Cannot delete a debt connected to instalments')
    WHERE EXISTS(SELECT 1 FROM commitment_debt_links WHERE debt_id=OLD.id);
END;
CREATE TRIGGER IF NOT EXISTS debt_no_payment_when_archived
BEFORE INSERT ON debt_payments
WHEN (SELECT archived_at FROM debts WHERE id=NEW.debt_id) IS NOT NULL
BEGIN SELECT RAISE(ABORT,'Archived debt cannot receive repayments'); END;
CREATE TRIGGER IF NOT EXISTS debt_no_link_when_archived
BEFORE INSERT ON commitment_debt_links
WHEN (SELECT archived_at FROM debts WHERE id=NEW.debt_id) IS NOT NULL
BEGIN SELECT RAISE(ABORT,'Archived debt cannot be linked to instalments'); END;

CREATE TRIGGER IF NOT EXISTS debt_archived_fields_readonly
BEFORE UPDATE OF name,creditor,starting_balance_sen,as_of_date,note ON debts
WHEN OLD.archived_at IS NOT NULL
BEGIN SELECT RAISE(ABORT,'Restore this debt before editing its details'); END;
