
-- PocketKu: Account Transaction Ledger
-- All monetary amounts are stored in sen.
-- Opening balances remain in the accounts table.

CREATE TABLE IF NOT EXISTS account_ledger (
    id INTEGER PRIMARY KEY AUTOINCREMENT,

    entry_type TEXT NOT NULL
        CHECK (
            entry_type IN (
                'income',
                'expense',
                'transfer',
                'adjustment'
            )
        ),

    account_id INTEGER NOT NULL,

    destination_account_id INTEGER,

    amount_sen INTEGER NOT NULL
        CHECK (amount_sen != 0),

    note TEXT,

    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,

    FOREIGN KEY (account_id)
        REFERENCES accounts(id)
        ON DELETE RESTRICT,

    FOREIGN KEY (destination_account_id)
        REFERENCES accounts(id)
        ON DELETE RESTRICT,

    CHECK (
        (
            entry_type = 'transfer'
            AND destination_account_id IS NOT NULL
            AND destination_account_id != account_id
            AND amount_sen > 0
        )
        OR
        (
            entry_type IN ('income', 'expense')
            AND destination_account_id IS NULL
            AND amount_sen > 0
        )
        OR
        (
            entry_type = 'adjustment'
            AND destination_account_id IS NULL
        )
    )
);

CREATE INDEX IF NOT EXISTS idx_ledger_account
    ON account_ledger(account_id);

CREATE INDEX IF NOT EXISTS idx_ledger_destination
    ON account_ledger(destination_account_id);
