
-- PocketKu: Accounts and Tabung

CREATE TABLE IF NOT EXISTS accounts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,

    name TEXT NOT NULL,
    bank_name TEXT NOT NULL,

    account_type TEXT NOT NULL
        CHECK (account_type IN ('bank', 'tabung')),

    opening_balance_sen INTEGER NOT NULL DEFAULT 0
        CHECK (opening_balance_sen >= 0),

    is_protected INTEGER NOT NULL DEFAULT 0
        CHECK (is_protected IN (0, 1)),

    is_active INTEGER NOT NULL DEFAULT 1
        CHECK (is_active IN (0, 1)),

    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
