-- PocketKu Step 7.21: two independent checklists, NEVER part of the bank ledger.
-- All money amounts stored in integer sen. Nothing in these tables changes accounts.
CREATE TABLE IF NOT EXISTS shared_collections (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  creation_key TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL CHECK(length(trim(name)) BETWEEN 1 AND 120),
  period TEXT NOT NULL CHECK(length(period)=7 AND substr(period,5,1)='-' AND substr(period,6,2) BETWEEN '01' AND '12'),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(name COLLATE NOCASE, period)
);
CREATE INDEX IF NOT EXISTS idx_shared_collections_period ON shared_collections(period, id);
CREATE TABLE IF NOT EXISTS shared_members (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  collection_id INTEGER NOT NULL REFERENCES shared_collections(id) ON DELETE RESTRICT,
  member_name TEXT NOT NULL CHECK(length(trim(member_name)) BETWEEN 1 AND 100),
  share_sen INTEGER NOT NULL CHECK(share_sen>=0 AND share_sen<=100000000000),
  is_self INTEGER NOT NULL DEFAULT 0 CHECK(is_self IN (0,1)),
  received INTEGER NOT NULL DEFAULT 0 CHECK(received IN (0,1)),
  received_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(collection_id,member_name COLLATE NOCASE),
  CHECK ((received=0 AND received_at IS NULL) OR (received=1 AND received_at IS NOT NULL)),
  CHECK (is_self=0 OR (received=0 AND received_at IS NULL))
);
CREATE INDEX IF NOT EXISTS idx_shared_members_parent ON shared_members(collection_id,id);

CREATE TABLE IF NOT EXISTS family_reminders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  creation_key TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL CHECK(length(trim(name)) BETWEEN 1 AND 120),
  amount_sen INTEGER NOT NULL CHECK(amount_sen>0 AND amount_sen<=100000000000),
  first_due_date TEXT NOT NULL CHECK(length(first_due_date)=10),
  frequency TEXT NOT NULL CHECK(frequency IN ('one-time','monthly','yearly')),
  note TEXT NOT NULL DEFAULT '' CHECK(length(note)<=500),
  is_active INTEGER NOT NULL DEFAULT 1 CHECK(is_active IN (0,1)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_family_reminder_active ON family_reminders(is_active,first_due_date);
CREATE TABLE IF NOT EXISTS family_reminder_checks (
  reminder_id INTEGER NOT NULL REFERENCES family_reminders(id) ON DELETE RESTRICT,
  due_date TEXT NOT NULL CHECK(length(due_date)=10),
  is_paid INTEGER NOT NULL CHECK(is_paid IN (0,1)),
  paid_at TEXT,
  -- Snapshot amount as of checklist change; older entries remain intact after edits.
  amount_sen INTEGER NOT NULL CHECK(amount_sen>0),
  PRIMARY KEY(reminder_id,due_date),
  CHECK ((is_paid=0 AND paid_at IS NULL) OR (is_paid=1 AND paid_at IS NOT NULL))
);
