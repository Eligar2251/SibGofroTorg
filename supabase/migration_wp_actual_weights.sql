-- Фактический склад и раздельные веса/деньги макулатуры.
ALTER TABLE wp_intakes ADD COLUMN IF NOT EXISTS accepted_weight_kg NUMERIC(12,3) NOT NULL DEFAULT 0;
ALTER TABLE wp_intakes ADD COLUMN IF NOT EXISTS payable_weight_kg NUMERIC(12,3) NOT NULL DEFAULT 0;
ALTER TABLE wp_shipments ADD COLUMN IF NOT EXISTS shipped_weight_kg NUMERIC(12,3) NOT NULL DEFAULT 0;
ALTER TABLE wp_shipments ADD COLUMN IF NOT EXISTS accepted_weight_kg NUMERIC(12,3) NOT NULL DEFAULT 0;
ALTER TABLE wp_shipments ADD COLUMN IF NOT EXISTS received_amount NUMERIC(14,2) NOT NULL DEFAULT 0;
ALTER TABLE wp_shipments ADD COLUMN IF NOT EXISTS bank_posted_at TIMESTAMPTZ;
