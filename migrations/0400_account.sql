-- T07: профиль, адреса, избранное и сравнение. Время — unix-мс.
-- Гость хранится по guest_id (cookie rts_guest), вошедший — по user_id; ровно одно из двух.

CREATE TABLE user_profiles (
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  name TEXT,
  phone TEXT,
  updated_at INTEGER NOT NULL
);

CREATE TABLE user_addresses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  label TEXT,
  address TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_user_addresses_user ON user_addresses (user_id);

CREATE TABLE favorites (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  guest_id TEXT,
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  CHECK ((user_id IS NOT NULL) <> (guest_id IS NOT NULL))
);
CREATE UNIQUE INDEX ux_favorites_user ON favorites (user_id, product_id) WHERE user_id IS NOT NULL;
CREATE UNIQUE INDEX ux_favorites_guest ON favorites (guest_id, product_id) WHERE guest_id IS NOT NULL;

CREATE TABLE compare_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  guest_id TEXT,
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  CHECK ((user_id IS NOT NULL) <> (guest_id IS NOT NULL))
);
CREATE UNIQUE INDEX ux_compare_user ON compare_items (user_id, product_id) WHERE user_id IS NOT NULL;
CREATE UNIQUE INDEX ux_compare_guest ON compare_items (guest_id, product_id) WHERE guest_id IS NOT NULL;
