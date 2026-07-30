import { PackagePlus } from "lucide-react";

const ORDER_NOTE = "Мало или нет в наличии? Привезём под заказ.";

/** Короткая общая подсказка для популярных товаров и страниц категорий. */
export function CatalogOrderNote() {
  return (
    <span className="catalog-order-note" title={ORDER_NOTE}>
      <PackagePlus size={14} aria-hidden="true" />
      <span>{ORDER_NOTE}</span>
    </span>
  );
}
