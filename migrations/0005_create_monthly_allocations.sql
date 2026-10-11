-- PocketKu Step 7.17: persistent monthly allocation plans.
-- Planning-only: this migration does not move cash or create ledger entries.
-- Amounts are always integer sen. Allocation month and provider due date are separate.

CREATE TABLE IF NOT EXISTS monthly_commitments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  creation_key TEXT NOT NULL UNIQUE,
  series_key TEXT,
  allocation_month TEXT NOT NULL
    CHECK (length(allocation_month)=7 AND substr(allocation_month,5,1)='-'
       AND substr(allocation_month,6,2) BETWEEN '01' AND '12'),
  name TEXT NOT NULL CHECK(length(trim(name)) BETWEEN 1 AND 120),
  category TEXT NOT NULL DEFAULT 'Bill' CHECK(length(trim(category)) BETWEEN 1 AND 60),
  amount_sen INTEGER NOT NULL CHECK(amount_sen>=0 AND amount_sen<=100000000000),
  due_date TEXT CHECK(due_date IS NULL OR length(due_date)=10),
  installment_no INTEGER,
  installment_total INTEGER,
  status TEXT NOT NULL DEFAULT 'unallocated'
    CHECK (status IN ('unallocated','reserved','paid')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK ((installment_no IS NULL AND installment_total IS NULL) OR
         (installment_total BETWEEN 1 AND 600 AND installment_no BETWEEN 1 AND installment_total)),
  UNIQUE(series_key,allocation_month)
);
CREATE INDEX IF NOT EXISTS idx_commitment_month ON monthly_commitments(allocation_month,id);
CREATE INDEX IF NOT EXISTS idx_commitment_series ON monthly_commitments(series_key,allocation_month);

-- Reserved for a future step: each item can draw from several D1 accounts.
-- Funding rows alone do not reserve cash until payment state is enabled.
CREATE TABLE IF NOT EXISTS commitment_funding (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  commitment_id INTEGER NOT NULL REFERENCES monthly_commitments(id) ON DELETE RESTRICT,
  account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
  amount_sen INTEGER NOT NULL CHECK(amount_sen>0),
  UNIQUE(commitment_id,account_id)
);
CREATE INDEX IF NOT EXISTS idx_commitment_funding_account ON commitment_funding(account_id);

-- Later paid commitments will link each bank debit to its own ledger entry.
CREATE TABLE IF NOT EXISTS commitment_payments (
  commitment_id INTEGER NOT NULL REFERENCES monthly_commitments(id) ON DELETE RESTRICT,
  account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
  ledger_entry_id INTEGER NOT NULL UNIQUE REFERENCES account_ledger(id) ON DELETE RESTRICT,
  PRIMARY KEY(commitment_id,account_id)
);
