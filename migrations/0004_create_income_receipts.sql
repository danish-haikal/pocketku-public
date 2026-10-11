
-- PocketKu: Expected Income and Receipts
-- Monetary amounts are stored in sen.
-- Actual money movements are recorded in account_ledger.

CREATE TABLE IF NOT EXISTS income_receipts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,

    -- Unique identity to prevent duplicate receipts
    income_key TEXT NOT NULL UNIQUE,

    source_name TEXT NOT NULL,

    income_type TEXT NOT NULL
        CHECK (
            income_type IN (
                'mara',
                'refund',
                'family',
                'other'
            )
        ),

    -- Example: 2026-10 for October MARA
    period TEXT,

    expected_amount_sen INTEGER
        CHECK (expected_amount_sen >= 0),

    expected_date TEXT,

    -- NULL until money is confirmed received
    ledger_entry_id INTEGER UNIQUE,

    received_at TEXT,

    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,

    FOREIGN KEY (ledger_entry_id)
        REFERENCES account_ledger(id)
        ON DELETE RESTRICT,

    CHECK (
        (ledger_entry_id IS NULL AND received_at IS NULL)
        OR
        (ledger_entry_id IS NOT NULL AND received_at IS NOT NULL)
    )
);

CREATE INDEX IF NOT EXISTS idx_income_type_period
    ON income_receipts(income_type, period);
