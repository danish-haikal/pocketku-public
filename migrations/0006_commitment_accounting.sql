-- PocketKu Step 7.18: atomic monthly commitment funding / reservation / payment.
-- Uses SQLite triggers so a paid commitment and its ledger debits cannot diverge.
-- Only apply locally until login and production testing are complete.

-- Funding can only change BEFORE a commitment is reserved.
CREATE TRIGGER IF NOT EXISTS commitment_funding_insert_guard
BEFORE INSERT ON commitment_funding
BEGIN
 SELECT RAISE(ABORT, 'Commitment is not editable')
 WHERE COALESCE((SELECT status FROM monthly_commitments WHERE id=NEW.commitment_id), '') <> 'unallocated';
 SELECT RAISE(ABORT, 'Funding exceeds commitment amount')
 WHERE NEW.amount_sen + COALESCE((SELECT SUM(amount_sen) FROM commitment_funding
       WHERE commitment_id=NEW.commitment_id AND account_id<>NEW.account_id),0)
       > (SELECT amount_sen FROM monthly_commitments WHERE id=NEW.commitment_id);
END;

CREATE TRIGGER IF NOT EXISTS commitment_funding_update_guard
BEFORE UPDATE ON commitment_funding
BEGIN
 SELECT RAISE(ABORT, 'Cannot modify reserved or paid funding')
 WHERE (SELECT status FROM monthly_commitments WHERE id=OLD.commitment_id)<>'unallocated'
   OR NEW.commitment_id<>OLD.commitment_id OR NEW.account_id<>OLD.account_id;
 SELECT RAISE(ABORT, 'Funding exceeds commitment amount')
 WHERE NEW.amount_sen + COALESCE((SELECT SUM(amount_sen) FROM commitment_funding
       WHERE commitment_id=OLD.commitment_id AND id<>OLD.id),0)
       > (SELECT amount_sen FROM monthly_commitments WHERE id=OLD.commitment_id);
END;

CREATE TRIGGER IF NOT EXISTS commitment_funding_delete_guard
BEFORE DELETE ON commitment_funding
BEGIN
 SELECT RAISE(ABORT, 'Cannot remove funding from a reserved or paid commitment')
 WHERE (SELECT status FROM monthly_commitments WHERE id=OLD.commitment_id)<>'unallocated';
END;

CREATE TRIGGER IF NOT EXISTS commitment_amount_guard
BEFORE UPDATE OF amount_sen ON monthly_commitments
BEGIN
 SELECT RAISE(ABORT, 'Amount below assigned funding')
 WHERE NEW.amount_sen < COALESCE((SELECT SUM(amount_sen)
       FROM commitment_funding WHERE commitment_id=OLD.id),0);
END;

-- One atomic status transition: funding must be complete and cash available.
CREATE TRIGGER IF NOT EXISTS commitment_status_guard
BEFORE UPDATE OF status ON monthly_commitments
WHEN OLD.status<>NEW.status
BEGIN
 SELECT RAISE(ABORT, 'Invalid commitment state transition')
 WHERE NOT ((OLD.status='unallocated' AND NEW.status='reserved')
        OR (OLD.status='reserved' AND NEW.status IN ('unallocated','paid')));
 SELECT RAISE(ABORT, 'Commitment must be fully funded before reserving or paying')
 WHERE NEW.status IN ('reserved','paid') AND
   (NEW.amount_sen<=0 OR COALESCE((SELECT SUM(amount_sen)
      FROM commitment_funding WHERE commitment_id=NEW.id),0)<>NEW.amount_sen);
 SELECT RAISE(ABORT, 'Insufficient unreserved account balance')
 WHERE NEW.status IN ('reserved','paid') AND EXISTS (
   SELECT 1 FROM commitment_funding AS f
   JOIN accounts AS a ON a.id=f.account_id
   WHERE f.commitment_id=NEW.id AND (
     a.is_active<>1 OR
     a.opening_balance_sen + COALESCE((
        SELECT SUM(CASE
          WHEN l.account_id=a.id AND l.entry_type IN ('income','adjustment') THEN l.amount_sen
          WHEN l.account_id=a.id AND l.entry_type IN ('expense','transfer') THEN -l.amount_sen
          WHEN l.destination_account_id=a.id AND l.entry_type='transfer' THEN l.amount_sen
          ELSE 0 END)
        FROM account_ledger l
        WHERE l.account_id=a.id OR l.destination_account_id=a.id
      ),0) - COALESCE((
        SELECT SUM(rf.amount_sen) FROM commitment_funding rf
        JOIN monthly_commitments rc ON rc.id=rf.commitment_id
        WHERE rf.account_id=a.id AND rc.status='reserved' AND rc.id<>NEW.id
      ),0) < f.amount_sen
   )
 );
END;

-- SQLite runs this AFTER trigger inside the same UPDATE statement/transaction.
-- If any ledger insert fails, the status change also rolls back.
CREATE TRIGGER IF NOT EXISTS commitment_pay_ledger
AFTER UPDATE OF status ON monthly_commitments
WHEN OLD.status='reserved' AND NEW.status='paid'
BEGIN
 INSERT INTO account_ledger
   (entry_type,account_id,destination_account_id,amount_sen,note,request_id)
 SELECT 'expense', f.account_id, NULL, f.amount_sen,
        'PocketKu commitment #' || NEW.id || ': ' || NEW.name,
        'commitment:' || NEW.id || ':account:' || f.account_id
 FROM commitment_funding f
 WHERE f.commitment_id=NEW.id;

 INSERT INTO commitment_payments(commitment_id,account_id,ledger_entry_id)
 SELECT NEW.id, f.account_id, l.id
 FROM commitment_funding f
 JOIN account_ledger l ON l.request_id=
   'commitment:' || NEW.id || ':account:' || f.account_id
 WHERE f.commitment_id=NEW.id;
END;
