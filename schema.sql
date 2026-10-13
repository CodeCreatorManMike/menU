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

-- Default items with typical UK supermarket prices (estimates, not live prices).
-- Used to autofill ingredient prices. Prices from meals you save take priority.
CREATE TABLE IF NOT EXISTS catalog (
  name_lc TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  qty TEXT NOT NULL DEFAULT '',
  price_pence INTEGER NOT NULL
);

INSERT OR IGNORE INTO catalog (name_lc, name, qty, price_pence) VALUES
  ('chicken breast', 'Chicken breast', '1kg', 650),
  ('chicken thighs', 'Chicken thighs', '1kg', 450),
  ('whole chicken', 'Whole chicken', '1.5kg', 500),
  ('beef mince', 'Beef mince', '500g', 320),
  ('diced beef', 'Diced beef', '500g', 450),
  ('pork mince', 'Pork mince', '500g', 280),
  ('sausages', 'Sausages', '8 pack', 280),
  ('bacon', 'Bacon', '8 rashers', 300),
  ('chorizo', 'Chorizo', '225g', 280),
  ('salmon fillets', 'Salmon fillets', '2 pack', 400),
  ('prawns', 'Prawns', '200g', 350),
  ('tinned tuna', 'Tinned tuna', '4 pack', 300),
  ('milk', 'Milk', '4 pints', 155),
  ('butter', 'Butter', '250g', 250),
  ('cheddar', 'Cheddar', '400g', 380),
  ('mozzarella', 'Mozzarella', '125g', 100),
  ('parmesan', 'Parmesan', '100g', 250),
  ('feta', 'Feta', '200g', 200),
  ('halloumi', 'Halloumi', '225g', 250),
  ('ricotta', 'Ricotta', '250g', 150),
  ('double cream', 'Double cream', '300ml', 180),
  ('natural yoghurt', 'Natural yoghurt', '500g', 100),
  ('eggs', 'Eggs', '12', 300),
  ('onions', 'Onions', '1kg', 100),
  ('garlic', 'Garlic', '3 bulbs', 100),
  ('spring onions', 'Spring onions', '1 bunch', 75),
  ('potatoes', 'Potatoes', '2.5kg', 270),
  ('sweet potatoes', 'Sweet potatoes', '1kg', 130),
  ('carrots', 'Carrots', '1kg', 80),
  ('broccoli', 'Broccoli', '1 head', 90),
  ('cauliflower', 'Cauliflower', '1 head', 100),
  ('peppers', 'Peppers', '3 pack', 150),
  ('mushrooms', 'Mushrooms', '300g', 130),
  ('courgettes', 'Courgettes', '3', 120),
  ('tomatoes', 'Tomatoes', '6', 150),
  ('cherry tomatoes', 'Cherry tomatoes', '300g', 130),
  ('spinach', 'Spinach', '200g', 130),
  ('lettuce', 'Lettuce', '1', 100),
  ('cucumber', 'Cucumber', '1', 90),
  ('leeks', 'Leeks', '3', 130),
  ('ginger', 'Ginger', '100g', 90),
  ('chillies', 'Chillies', '1 pack', 70),
  ('lemons', 'Lemons', '3', 90),
  ('limes', 'Limes', '3', 90),
  ('bananas', 'Bananas', '5', 80),
  ('frozen peas', 'Frozen peas', '1kg', 150),
  ('frozen sweetcorn', 'Frozen sweetcorn', '1kg', 150),
  ('sweetcorn', 'Sweetcorn', '340g tin', 80),
  ('chopped tomatoes', 'Chopped tomatoes', '400g tin', 60),
  ('passata', 'Passata', '500g', 100),
  ('tomato puree', 'Tomato puree', '200g', 90),
  ('kidney beans', 'Kidney beans', '400g tin', 70),
  ('chickpeas', 'Chickpeas', '400g tin', 70),
  ('baked beans', 'Baked beans', '4 pack', 230),
  ('coconut milk', 'Coconut milk', '400ml tin', 130),
  ('spaghetti', 'Spaghetti', '500g', 90),
  ('penne', 'Penne', '500g', 90),
  ('lasagne sheets', 'Lasagne sheets', '250g', 120),
  ('egg noodles', 'Egg noodles', '5 nests', 200),
  ('basmati rice', 'Basmati rice', '1kg', 200),
  ('rice', 'Rice', '1kg', 130),
  ('plain flour', 'Plain flour', '1.5kg', 110),
  ('sugar', 'Sugar', '1kg', 130),
  ('bread', 'Bread', '800g loaf', 130),
  ('tortilla wraps', 'Tortilla wraps', '8 pack', 150),
  ('naan', 'Naan', '4 pack', 110),
  ('garlic bread', 'Garlic bread', '1', 100),
  ('tortilla chips', 'Tortilla chips', '200g', 150),
  ('olive oil', 'Olive oil', '500ml', 500),
  ('vegetable oil', 'Vegetable oil', '1L', 270),
  ('chicken stock cubes', 'Chicken stock cubes', '12 pack', 100),
  ('beef stock cubes', 'Beef stock cubes', '12 pack', 100),
  ('soy sauce', 'Soy sauce', '150ml', 160),
  ('tikka paste', 'Tikka paste', '1 jar', 150),
  ('green curry paste', 'Green curry paste', '1 jar', 200),
  ('curry powder', 'Curry powder', '1 jar', 100),
  ('cumin', 'Cumin', '1 jar', 110),
  ('paprika', 'Paprika', '1 jar', 100),
  ('chilli powder', 'Chilli powder', '1 jar', 100),
  ('mixed herbs', 'Mixed herbs', '1 jar', 100),
  ('black pepper', 'Black pepper', '1 jar', 130),
  ('salt', 'Salt', '750g', 70),
  ('honey', 'Honey', '340g', 250),
  ('mayonnaise', 'Mayonnaise', '400g', 200),
  ('ketchup', 'Ketchup', '460g', 200),
  ('taco seasoning', 'Taco seasoning', '1 sachet', 90),
  ('pesto', 'Pesto', '190g', 200),
  ('frozen chips', 'Frozen chips', '1.5kg', 200),
  ('pizza dough mix', 'Pizza dough mix', '1 pack', 150);
