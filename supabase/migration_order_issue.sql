-- =========================================================
-- Миграция: логин-аккаунты + код выдачи заказа
-- =========================================================
-- 1) Регистрация только по логину и паролю (без телефона/почты):
--    в users добавляется колонка username (уникальный логин).
-- 2) Код выдачи заказа: orders.pickup_code + orders.issued_at —
--    короткий код, который выдаётся клиенту после заказа и по которому
--    на вкладке «Выдача товара» в админке можно найти и выдать заказ.
-- 3) В перечень статусов заявки добавляется 'issued' (выдан).

-- ── users.username ──
ALTER TABLE users ADD COLUMN IF NOT EXISTS username TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_username ON users(username)
  WHERE username IS NOT NULL;

-- ── orders.pickup_code / issued_at ──
ALTER TABLE orders ADD COLUMN IF NOT EXISTS pickup_code TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS issued_at TIMESTAMPTZ;
CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_pickup_code ON orders(pickup_code)
  WHERE pickup_code IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_orders_issued_at ON orders(issued_at)
  WHERE issued_at IS NOT NULL;

-- ── статус 'issued' в CHECK-ограничении ──
ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_status_check;
ALTER TABLE orders ADD CONSTRAINT orders_status_check
  CHECK (status IN ('new', 'in_progress', 'ready', 'issued', 'completed', 'rejected'));
