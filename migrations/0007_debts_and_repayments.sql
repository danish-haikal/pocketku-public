-- PocketKu 7.20: debts and actual repayments (local development only).
-- Opening debt is an outstanding snapshot as at its start date; it is NOT cash.
-- Direct payments debit the bank exactly once. Linked commitment payments never debit again.

CREATE TABLE IF NOT EXISTS debts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  creation_key TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL CHECK(length(trim(name)) BETWEEN 1 AND 120),
  creditor TEXT NOT NULL DEFAULT '' CHECK(length(creditor)<=120),
  starting_balance_sen INTEGER NOT NULL CHECK(starting_balance_sen>0 AND starting_balance_sen<=100000000000),
  as_of_date TEXT NOT NULL CHECK(length(as_of_date)=10),
  note TEXT NOT NULL DEFAULT '' CHECK(length(note)<=500),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS debt_payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  payment_key TEXT NOT NULL UNIQUE,
  debt_id INTEGER NOT NULL REFERENCES debts(id) ON DELETE RESTRICT,
  mode TEXT NOT NULL CHECK(mode IN ('direct','commitment')),
  amount_sen INTEGER NOT NULL CHECK(amount_sen BETWEEN 1 AND 100000000000),
  account_id INTEGER REFERENCES accounts(id) ON DELETE RESTRICT,
  commitment_id INTEGER REFERENCES monthly_commitments(id) ON DELETE RESTRICT,
  ledger_entry_id INTEGER UNIQUE REFERENCES account_ledger(id) ON DELETE RESTRICT,
  acknowledge_protected INTEGER NOT NULL DEFAULT 0 CHECK(acknowledge_protected IN (0,1)),
  paid_on TEXT NOT NULL CHECK(length(paid_on)=10),
  note TEXT NOT NULL DEFAULT '' CHECK(length(note)<=300),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK ((mode='direct' AND account_id IS NOT NULL AND commitment_id IS NULL) OR
         (mode='commitment' AND account_id IS NULL AND commitment_id IS NOT NULL AND ledger_entry_id IS NULL))
);
CREATE INDEX IF NOT EXISTS idx_debt_payments_debt ON debt_payments(debt_id,id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_debt_link_once ON debt_payments(commitment_id) WHERE commitment_id IS NOT NULL;

CREATE TRIGGER IF NOT EXISTS debt_balance_update_guard
BEFORE UPDATE OF starting_balance_sen ON debts
BEGIN
  SELECT RAISE(ABORT,'Debt starting balance below recorded payments')
  WHERE NEW.starting_balance_sen < COALESCE((SELECT SUM(amount_sen) FROM debt_payments WHERE debt_id=OLD.id),0);
END;

CREATE TRIGGER IF NOT EXISTS debt_payment_insert_guard
BEFORE INSERT ON debt_payments
BEGIN
  SELECT RAISE(ABORT,'Payment exceeds debt outstanding balance')
  WHERE NEW.amount_sen > COALESCE((SELECT starting_balance_sen FROM debts WHERE id=NEW.debt_id),0)
    - COALESCE((SELECT SUM(amount_sen) FROM debt_payments WHERE debt_id=NEW.debt_id),0);

  SELECT RAISE(ABORT,'Bank account is missing or inactive')
  WHERE NEW.mode='direct' AND NOT EXISTS (
    SELECT 1 FROM accounts WHERE id=NEW.account_id AND is_active=1
  );
  SELECT RAISE(ABORT,'Protected savings confirmation required')
  WHERE NEW.mode='direct' AND EXISTS (
    SELECT 1 FROM accounts WHERE id=NEW.account_id AND is_protected=1
  ) AND NEW.acknowledge_protected<>1;

  -- Cash = starting balance + all ledger movements. A reservation is NOT a cash debit;
  -- still subtract it when deciding if another outgoing payment can be afforded.
  SELECT RAISE(ABORT,'Insufficient available balance after reservations')
  WHERE NEW.mode='direct' AND (
    SELECT a.opening_balance_sen + COALESCE((
      SELECT SUM(CASE
        WHEN l.account_id=a.id AND l.entry_type IN ('income','adjustment') THEN l.amount_sen
        WHEN l.account_id=a.id AND l.entry_type IN ('expense','transfer') THEN -l.amount_sen
        WHEN l.destination_account_id=a.id AND l.entry_type='transfer' THEN l.amount_sen
        ELSE 0 END)
      FROM account_ledger l WHERE l.account_id=a.id OR l.destination_account_id=a.id
    ),0) - COALESCE((
      SELECT SUM(f.amount_sen) FROM commitment_funding f
      JOIN monthly_commitments c ON c.id=f.commitment_id
      WHERE f.account_id=a.id AND c.status='reserved'
    ),0) FROM accounts a WHERE a.id=NEW.account_id
  ) < NEW.amount_sen;

  SELECT RAISE(ABORT,'Only an already-paid commitment can be linked')
  WHERE NEW.mode='commitment' AND NOT EXISTS (
    SELECT 1 FROM monthly_commitments c
    WHERE c.id=NEW.commitment_id AND c.status='paid'
      AND (SELECT COALESCE(SUM(l.amount_sen),0)
           FROM commitment_payments cp
           JOIN account_ledger l ON l.id=cp.ledger_entry_id
           WHERE cp.commitment_id=c.id AND l.entry_type='expense') >= NEW.amount_sen
  );
END;

-- SQLite/D1 performs all work in the triggering INSERT's transaction.
-- Failure to insert bank debit rolls back debt_payment too.
CREATE TRIGGER IF NOT EXISTS debt_payment_post_ledger
AFTER INSERT ON debt_payments
WHEN NEW.mode='direct'
BEGIN
  INSERT INTO account_ledger(entry_type,account_id,destination_account_id,amount_sen,note,request_id)
  VALUES ('expense',NEW.account_id,NULL,NEW.amount_sen,
    'PocketKu debt #' || NEW.debt_id || ': ' || (SELECT name FROM debts WHERE id=NEW.debt_id),
    'debt:' || NEW.payment_key);
  UPDATE debt_payments SET ledger_entry_id=(
    SELECT id FROM account_ledger WHERE request_id='debt:' || NEW.payment_key
  ) WHERE id=NEW.id;
END;

-- Repayments are permanent financial records. Internal trigger may set ledger link once.
CREATE TRIGGER IF NOT EXISTS debt_payment_update_guard
BEFORE UPDATE ON debt_payments
WHEN NOT (OLD.mode='direct' AND OLD.ledger_entry_id IS NULL
          AND NEW.ledger_entry_id IS NOT NULL
          AND OLD.payment_key=NEW.payment_key AND OLD.debt_id=NEW.debt_id
          AND OLD.mode=NEW.mode AND OLD.amount_sen=NEW.amount_sen
          AND OLD.account_id=NEW.account_id AND OLD.paid_on=NEW.paid_on
          AND OLD.note=NEW.note AND OLD.acknowledge_protected=NEW.acknowledge_protected)
BEGIN
  SELECT RAISE(ABORT,'Posted debt payments cannot be edited');
END;
CREATE TRIGGER IF NOT EXISTS debt_payment_delete_guard
BEFORE DELETE ON debt_payments
BEGIN
  SELECT RAISE(ABORT,'Posted debt payments cannot be deleted');
END;
