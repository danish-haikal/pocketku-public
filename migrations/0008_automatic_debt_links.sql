-- PocketKu Step 7.20.1 — associate a financing bill with a debt BEFORE paying.
-- Linking is planning-only. Paying the bill performs the bank debit and debt
-- reduction in one SQLite statement transaction. No second bank debit is posted.
-- Deployed against a local D1 database with migrations 0001-0007 already applied.

CREATE TABLE IF NOT EXISTS commitment_debt_links (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  debt_id INTEGER NOT NULL REFERENCES debts(id) ON DELETE RESTRICT,
  commitment_id INTEGER REFERENCES monthly_commitments(id) ON DELETE CASCADE,
  series_key TEXT,
  from_month TEXT,
  principal_sen INTEGER CHECK(principal_sen IS NULL OR principal_sen > 0),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK ((commitment_id IS NOT NULL AND series_key IS NULL AND from_month IS NULL)
      OR (commitment_id IS NULL AND series_key IS NOT NULL AND length(series_key)>0
        AND from_month IS NOT NULL AND length(from_month)=7))
);
CREATE UNIQUE INDEX IF NOT EXISTS commitment_debt_one ON commitment_debt_links(commitment_id) WHERE commitment_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS commitment_debt_series ON commitment_debt_links(series_key) WHERE series_key IS NOT NULL;

CREATE TRIGGER IF NOT EXISTS commitment_debt_link_guard
BEFORE INSERT ON commitment_debt_links
BEGIN
  SELECT RAISE(ABORT,'Debt is already settled')
  WHERE (SELECT starting_balance_sen-COALESCE((SELECT SUM(amount_sen) FROM debt_payments WHERE debt_id=NEW.debt_id),0)
         FROM debts WHERE id=NEW.debt_id) <= 0;

  SELECT RAISE(ABORT,'Connect only unpaid commitments')
  WHERE NEW.commitment_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM monthly_commitments c WHERE c.id=NEW.commitment_id AND c.status<>'paid'
  );
  SELECT RAISE(ABORT,'The principal amount exceeds this bill')
  WHERE NEW.commitment_id IS NOT NULL AND NEW.principal_sen IS NOT NULL
    AND NEW.principal_sen > (SELECT amount_sen FROM monthly_commitments WHERE id=NEW.commitment_id);
  SELECT RAISE(ABORT,'This instalment is already linked through its series')
  WHERE NEW.commitment_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM monthly_commitments c JOIN commitment_debt_links l ON l.series_key=c.series_key
    WHERE c.id=NEW.commitment_id AND c.allocation_month>=l.from_month
  );

  SELECT RAISE(ABORT,'Recurring schedule not found or has no upcoming unpaid instalments')
  WHERE NEW.series_key IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM monthly_commitments c
    WHERE c.series_key=NEW.series_key AND c.allocation_month>=NEW.from_month AND c.status<>'paid'
  );
  SELECT RAISE(ABORT,'One or more future instalments are already linked individually')
  WHERE NEW.series_key IS NOT NULL AND EXISTS (
    SELECT 1 FROM monthly_commitments c JOIN commitment_debt_links l ON l.commitment_id=c.id
    WHERE c.series_key=NEW.series_key AND c.allocation_month>=NEW.from_month
  );
  SELECT RAISE(ABORT,'The principal amount exceeds a future instalment')
  WHERE NEW.series_key IS NOT NULL AND NEW.principal_sen IS NOT NULL AND EXISTS (
    SELECT 1 FROM monthly_commitments c WHERE c.series_key=NEW.series_key
      AND c.allocation_month>=NEW.from_month AND c.status<>'paid' AND c.amount_sen<NEW.principal_sen
  );
END;

-- Changing an existing link could rewrite financial meaning after payment.
CREATE TRIGGER IF NOT EXISTS commitment_debt_link_no_update
BEFORE UPDATE ON commitment_debt_links
BEGIN SELECT RAISE(ABORT,'Remove an unused link and create a new one'); END;

-- Removing a link disables future automatic reductions only. Previous payments
-- remain permanently recorded in debt_payments and cannot be reversed here.

-- The existing pay trigger inserts commitment_payments AFTER posting the bank
-- ledger debit(s). This trigger runs after each payment row; only the LAST one
-- can update the debt. An error rolls the ENTIRE paid transition back.
CREATE TRIGGER IF NOT EXISTS commitment_payment_auto_debt
AFTER INSERT ON commitment_payments
BEGIN
  INSERT INTO debt_payments (
    payment_key,debt_id,mode,amount_sen,account_id,commitment_id,ledger_entry_id,paid_on,note
  )
  SELECT 'auto:commitment:'||c.id,COALESCE(ind.debt_id,ser.debt_id),'commitment',
    COALESCE(ind.principal_sen,ser.principal_sen,c.amount_sen),NULL,c.id,NULL,
    date('now','+8 hours'),'Automatically updated from Monthly Planner'
  FROM monthly_commitments c
  LEFT JOIN commitment_debt_links ind ON ind.commitment_id=c.id
  LEFT JOIN commitment_debt_links ser ON ser.series_key=c.series_key AND c.allocation_month>=ser.from_month
  WHERE c.id=NEW.commitment_id AND c.status='paid'
    AND COALESCE(ind.debt_id,ser.debt_id) IS NOT NULL
    AND (SELECT COUNT(*) FROM commitment_payments cp WHERE cp.commitment_id=c.id)=
        (SELECT COUNT(*) FROM commitment_funding f WHERE f.commitment_id=c.id)
    AND (SELECT COALESCE(SUM(l.amount_sen),0) FROM commitment_payments cp
      JOIN account_ledger l ON l.id=cp.ledger_entry_id
      WHERE cp.commitment_id=c.id AND l.entry_type='expense')=c.amount_sen
    AND NOT EXISTS (SELECT 1 FROM debt_payments dp WHERE dp.commitment_id=c.id);
END;
