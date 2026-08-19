-- Доп. фото закупок (Cloudinary). Если колонки нет, сервер пишет только ozon_image_*.
alter table if exists warehouse_purchase_plans
  add column if not exists images jsonb default '[]'::jsonb;
