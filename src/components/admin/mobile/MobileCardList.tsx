// =========================================================
// FILE: src/components/admin/mobile/MobileCardList.tsx
// Карточный список — мобильная замена таблицы.
//
// Десктопную таблицу этот компонент НЕ заменяет и не трогает:
// экран решает, что рендерить —
//
//   const isMobile = useIsMobile();
//   …
//   {isMobile ? (
//     <MobileCardList
//       rows={items}
//       keyOf={(item) => item.id}
//       title={(item) => item.name}
//       badge={(item) => <span className="admin-badge">{item.status}</span>}
//       fields={[
//         { label: "Артикул", value: (i) => i.sku, mono: true },
//         { label: "Остаток", value: (i) => i.stock, strong: true },
//       ]}
//       actions={(item) => <button …>Изменить</button>}
//       empty="Ничего не найдено"
//     />
//   ) : (
//     <div className="admin-table-wrap"> …обычная таблица… </div>
//   )}
//
// Почему карточки, а не горизонтальный скролл таблицы: на 375px
// (iPhone X) в таблицу из 6+ колонок помещается треть строки, и
// смысл строки теряется — её приходится собирать глазами по частям,
// листая вбок. Карточка показывает всю запись сразу.
// =========================================================

"use client";

import type { ReactNode } from "react";
import styles from "./MobileCardList.module.css";

export type MobileCardField<T> = {
  /** Подпись слева (короткая, до 16 символов). */
  label: string;
  /** Значение справа. */
  value: (row: T) => ReactNode;
  /** Выделить значение (итоговые суммы, количество). */
  strong?: boolean;
  /** Моноширинный шрифт (артикулы, номера счетов). */
  mono?: boolean;
  /** Скрыть поле, если значение пустое. */
  hideWhenEmpty?: boolean;
};

export function MobileCardList<T>({
  rows,
  keyOf,
  title,
  badge,
  fields,
  actions,
  empty = "Нет записей",
}: {
  rows: readonly T[];
  keyOf: (row: T, index: number) => string | number;
  title: (row: T) => ReactNode;
  badge?: (row: T) => ReactNode;
  fields: MobileCardField<T>[];
  actions?: (row: T) => ReactNode;
  empty?: ReactNode;
}) {
  if (rows.length === 0) {
    return <div className={styles.empty}>{empty}</div>;
  }

  return (
    <div className={styles.list}>
      {rows.map((row, index) => {
        const rendered = fields
          .filter((field) => {
            if (!field.hideWhenEmpty) return true;
            const value = field.value(row);
            return value !== null && value !== undefined && value !== "";
          })
          .map((field) => (
            <FragmentRow key={field.label} field={field} row={row} />
          ));

        const acts = actions?.(row);

        return (
          <article className={styles.card} key={keyOf(row, index)}>
            <div className={styles.head}>
              <h3 className={styles.title}>{title(row)}</h3>
              {badge ? <div className={styles.badge}>{badge(row)}</div> : null}
            </div>

            {rendered.length > 0 && <div className={styles.rows}>{rendered}</div>}

            {acts ? <div className={styles.actions}>{acts}</div> : null}
          </article>
        );
      })}
    </div>
  );
}

function FragmentRow<T>({
  field,
  row,
}: {
  field: MobileCardField<T>;
  row: T;
}) {
  const value = field.value(row);
  const className = [
    styles.value,
    field.strong ? styles.strong : "",
    field.mono ? styles.mono : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <>
      <span className={styles.label}>{field.label}</span>
      <span className={className}>{value}</span>
    </>
  );
}
