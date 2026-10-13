CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  name_lc TEXT NOT NULL UNIQUE,
  pin_hash TEXT NOT NULL,
  salt TEXT NOT NULL,
  avatar_key TEXT,
  is_admin INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS meals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  image_key TEXT,
  date TEXT,
  status TEXT NOT NULL DEFAULT 'scheduled', -- scheduled | requested
  cook_id TEXT,
  requested_by TEXT,
  total_override_pence INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_meals_date ON meals(date);

CREATE TABLE IF NOT EXISTS ingredients (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  meal_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  qty TEXT NOT NULL DEFAULT '',
  price_pence INTEGER NOT NULL DEFAULT 0,
  have INTEGER NOT NULL DEFAULT 0,
  have_by TEXT, -- user who ticked it
  sort INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_ing_meal ON ingredients(meal_id);

CREATE TABLE IF NOT EXISTS rsvps (
  meal_id INTEGER NOT NULL,
  user_id TEXT NOT NULL,
  status TEXT NOT NULL, -- in | out (no row = no reply)
  PRIMARY KEY (meal_id, user_id)
);

CREATE TABLE IF NOT EXISTS payments (
  meal_id INTEGER NOT NULL,
  user_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'unpaid', -- unpaid | claimed | confirmed
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (meal_id, user_id)
);

CREATE TABLE IF NOT EXISTS images (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  data TEXT NOT NULL, -- base64
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

INSERT OR IGNORE INTO settings (key, value) VALUES
  ('bank_currency', 'British Pound'),
  ('bank_beneficiary', 'Michael Jones'),
  ('bank_sort_code', '04-29-09'),
  ('bank_account', '90918487'),
  ('bank_name', 'Revolut Ltd'),
  ('bank_address', '30 South Colonnade, E14 5HX, London, United Kingdom'),
  ('cook_weight', '0.5');
