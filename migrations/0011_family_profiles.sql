-- PocketKu Step 7.28 — family reminder profiles.
-- IMPORTANT: compatible with an already-populated family_reminders table.
-- Existing reminders are assigned to Mother (profile id 1), no checklist data changes.
CREATE TABLE IF NOT EXISTS family_profiles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL COLLATE NOCASE UNIQUE CHECK(length(trim(name)) BETWEEN 1 AND 80),
  is_active INTEGER NOT NULL DEFAULT 1 CHECK(is_active IN (0,1)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT OR IGNORE INTO family_profiles(id,name) VALUES (1,'Mother');
-- SQLite does not permit ADD COLUMN REFERENCES ... NOT NULL DEFAULT 1 on a
-- populated table when foreign_keys=ON; enforce association with triggers.
ALTER TABLE family_reminders ADD COLUMN person_id INTEGER NOT NULL DEFAULT 1;
CREATE INDEX IF NOT EXISTS idx_family_reminder_person ON family_reminders(person_id,is_active);
CREATE TRIGGER IF NOT EXISTS family_reminder_profile_insert
BEFORE INSERT ON family_reminders
BEGIN
  SELECT RAISE(ABORT,'Invalid family member')
  WHERE NOT EXISTS(SELECT 1 FROM family_profiles p WHERE p.id=NEW.person_id AND p.is_active=1);
END;
CREATE TRIGGER IF NOT EXISTS family_reminder_profile_update
BEFORE UPDATE OF person_id ON family_reminders
BEGIN
  SELECT RAISE(ABORT,'Invalid family member')
  WHERE NOT EXISTS(SELECT 1 FROM family_profiles p WHERE p.id=NEW.person_id AND p.is_active=1);
END;
