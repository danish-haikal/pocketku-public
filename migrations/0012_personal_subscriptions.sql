-- Step 7.29. Personal subscription and trial reminders only.
-- No bank ledger or reservation changes. Existing data is unaffected.
CREATE TABLE IF NOT EXISTS personal_subscriptions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  create_key TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 120),
  provider TEXT NOT NULL DEFAULT '' CHECK(length(provider) <= 120),
  status TEXT NOT NULL DEFAULT 'trial' CHECK (status IN ('trial','active','cancelled')),
  renewal_amount_sen INTEGER NOT NULL DEFAULT 0 CHECK (renewal_amount_sen BETWEEN 0 AND 100000000000),
  next_charge_date TEXT NOT NULL CHECK (length(next_charge_date) = 10),
  cancel_by_date TEXT CHECK (cancel_by_date IS NULL OR length(cancel_by_date) = 10),
  billing_cycle TEXT NOT NULL DEFAULT 'monthly' CHECK (billing_cycle IN ('monthly','quarterly','half_yearly','yearly','one_time')),
  note TEXT NOT NULL DEFAULT '' CHECK (length(note) <= 1000),
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_personal_subscriptions_next_charge
  ON personal_subscriptions(is_active,status,next_charge_date);
