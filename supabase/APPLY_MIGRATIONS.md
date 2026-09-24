# Миграции ветки (что применить на боевой базе)

Все четыре файла **идемпотентны** — можно запускать повторно, ничего не сломается
(`IF NOT EXISTS`, `DROP CONSTRAINT IF EXISTS`, `ON CONFLICT DO NOTHING`).

Применять в Supabase Dashboard → SQL Editor, **строго по порядку** — и лучше
**до деплоя кода** этой ветки: часть форм пишет в новые колонки, без них
сохранение будет падать с ошибкой.

| № | Файл | Что добавляет | Что будет, если не применить |
|---|------|---------------|------------------------------|
| 1 | `migration_wp_stock_manual.sql` | `wp_shipments.skip_stock` + таблица `wp_stock_adjustments` | Не сохранится сдача макулатуры (падает запись `skip_stock`) и ручная правка остатка на вкладке «Склад» |
| 2 | `migration_wp_account_transfers.sql` | таблица `wp_account_transfers` + счётчик номеров | Вкладка «Банк» работает, но переводы между счетами не сохраняются (чтение деградирует в пустой список) |
| 3 | `migration_wp_transport_done.sql` | `wp_intakes.transport_done` + разовая простановка по старым приёмам | Не сохранится карточка/новый приём макулатуры (падает запись `transport_done`) |
| 4 | `migration_vm_card.sql` | `cash_collections.vm_transfer_amount` + расширение CHECK по `cash_destination` | Не сохранится сводка смены кассы (падает запись `vm_transfer_amount`) |

## Что должно быть применено раньше (из `main`)

Эти миграции эта ветка не создаёт, но без них новые не сработают:

- `migration_wastepaper_account.sql` — создаёт `wp_intakes`, `wp_shipments`
  (в них есть `transport_id`);
- `migration_wp_awaiting_weight.sql` — колонка `wp_intakes.awaiting_weight`
  (её читает `migration_wp_transport_done.sql`);
- `migration_cash_collections.sql` и `migration_cash_collection_split.sql` —
  таблица `cash_collections` (её меняет `migration_vm_card.sql`);
- `schema.sql` — `bank_payments` и `doc_counters`.

## 1. `supabase/migration_wp_stock_manual.sql`

Склад макулатуры: продажа «без списания» и ручная правка остатка.

```sql
-- Продажа без списания со склада
ALTER TABLE wp_shipments
  ADD COLUMN IF NOT EXISTS skip_stock BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS idx_wp_shipments_skip_stock
  ON wp_shipments(skip_stock)
  WHERE skip_stock = TRUE;

-- Ручная корректировка остатка по видам (храним разницу с расчётным остатком)
CREATE TABLE IF NOT EXISTS wp_stock_adjustments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  wastepaper_type TEXT NOT NULL,
  delta_kg NUMERIC(12,3) NOT NULL DEFAULT 0,
  note TEXT,
  created_by TEXT,
  updated_by TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_wp_stock_adjustments_type
  ON wp_stock_adjustments(wastepaper_type);

ALTER TABLE wp_stock_adjustments ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime')
     AND NOT EXISTS (SELECT 1 FROM pg_publication_tables
                     WHERE pubname = 'supabase_realtime' AND tablename = 'wp_stock_adjustments') THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE wp_stock_adjustments';
  END IF;
END $$;
```

## 2. `supabase/migration_wp_account_transfers.sql`

Переводы между счетами макулатуры (безнал ↔ наличка ↔ сторонние).

```sql
CREATE TABLE IF NOT EXISTS wp_account_transfers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  number INT NOT NULL DEFAULT 0,
  date DATE NOT NULL,
  from_account TEXT NOT NULL DEFAULT 'bank',   -- cash | bank | third_party
  to_account TEXT NOT NULL DEFAULT 'cash',     -- cash | bank | third_party
  amount NUMERIC(14,2) NOT NULL DEFAULT 0,
  comment TEXT,
  created_by TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_wp_account_transfers_date
  ON wp_account_transfers(date DESC);

ALTER TABLE wp_account_transfers ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime')
     AND NOT EXISTS (SELECT 1 FROM pg_publication_tables
                     WHERE pubname = 'supabase_realtime' AND tablename = 'wp_account_transfers') THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE wp_account_transfers';
  END IF;
END $$;

-- Счётчик номеров переводов (Перевод №1, №2, …)
INSERT INTO doc_counters (key, value) VALUES ('wp_account_transfer', 0)
ON CONFLICT (key) DO NOTHING;
```

## 3. `supabase/migration_wp_transport_done.sql`

Пометка «перевозка выполнена» на приёмах макулатуры: приём уходит из доставок и
очереди перевозок, а вес и оплату можно спокойно вписать позже.

```sql
ALTER TABLE wp_intakes
  ADD COLUMN IF NOT EXISTS transport_done boolean NOT NULL DEFAULT false;

-- Старые приёмы, которые уже ездили, помечаем выполненными,
-- иначе после миграции они снова появятся в доставках.
UPDATE wp_intakes
SET transport_done = true
WHERE transport_done = false
  AND (awaiting_weight = true OR transport_id IS NOT NULL);
```

## 4. `supabase/migration_vm_card.sql`

Вторая карта «Карта В.М.» — отдельный денежный счёт рядом с картой ЮМ.

```sql
-- Сколько из поступлений смены отмечено на карте В.М. (метка, не движение денег)
ALTER TABLE cash_collections
  ADD COLUMN IF NOT EXISTS vm_transfer_amount NUMERIC NOT NULL DEFAULT 0;

-- Разметка сдачи кассы умеет третью кассу — вторую карту.
ALTER TABLE bank_payments DROP CONSTRAINT IF EXISTS bank_payments_cash_destination_check;
ALTER TABLE bank_payments
  ADD CONSTRAINT bank_payments_cash_destination_check
  CHECK (cash_destination IN ('cash', 'card', 'vm_card'));
```

Деньги карты В.М. новых таблиц не требуют: платёж — `bank_payments.type =
'vm_card'` (на `type` ограничения нет), зарплата — `salaries.source = 'bank'` +
тег `[Карта В.М.]` в комментарии.

## Проверка после применения

```sql
SELECT 'wp_shipments.skip_stock' AS check_name,
       EXISTS (SELECT 1 FROM information_schema.columns
               WHERE table_name = 'wp_shipments' AND column_name = 'skip_stock') AS ok
UNION ALL SELECT 'wp_stock_adjustments',
       EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'wp_stock_adjustments')
UNION ALL SELECT 'wp_account_transfers',
       EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'wp_account_transfers')
UNION ALL SELECT 'wp_intakes.transport_done',
       EXISTS (SELECT 1 FROM information_schema.columns
               WHERE table_name = 'wp_intakes' AND column_name = 'transport_done')
UNION ALL SELECT 'cash_collections.vm_transfer_amount',
       EXISTS (SELECT 1 FROM information_schema.columns
               WHERE table_name = 'cash_collections' AND column_name = 'vm_transfer_amount');
```

Ожидаемый результат — **5 строк, во всех `ok = true`**.
