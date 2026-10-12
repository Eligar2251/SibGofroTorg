// =========================================================
// FILE: src/components/seo/PalletGuide.tsx
// Блок «Паллета 1200×800: какие размеры подходят» для посадочной
// «Коробки для маркетплейсов».
//
// Зачем отдельный блок: селлеры WB и Ozon считают тару слоями на
// стандартном поддоне. Схемы рисуем по реальным пропорциям короба
// (src/lib/pallet.ts) — если слой закрывает паллету не полностью,
// на картинке видно свободную полосу, а не «ровный» слой.
// Таблица собирается из тех же данных: цифры не расходятся с текстом.
// =========================================================

import {
  palletLayout,
  palletCells,
  formatPalletFootprint,
  PALLET_LENGTH_MM,
  PALLET_WIDTH_MM,
} from "@/lib/pallet";

/** Схемы, которые показываем картинками: ходовые раскладки селлеров. */
const SCHEMES: [number, number][] = [
  [600, 400],
  [400, 300],
  [600, 300],
];

/** Строки таблицы: паллетные размеры по популярности у WB и Ozon. */
const TABLE: [number, number, string][] = [
  [600, 400, "самый ходовой размер: 2 × 2 короба на поддоне"],
  [800, 600, "крупная тара: 2 короба вдоль длинной стороны"],
  [600, 300, "в слой входит 4 короба, полоса 200 мм остаётся свободной"],
  [400, 300, "мелкая тара: 8 коробов в слой"],
  [600, 200, "лёгкий товар: 8 коробов в слой"],
  [400, 400, "квадратные короба: 6 шт. в слой"],
  [300, 200, "микротара: 16 коробов в слой"],
  [1200, 800, "короб в размер паллеты — 1 шт. в слой"],
];

function Scheme({ length, width }: { length: number; width: number }) {
  const data = palletCells(length, width);
  if (!data) return null;
  const { layout, cells } = data;

  return (
    <figure className="mk-scheme">
      <div className="mk-scheme__board">
        <span className="mk-scheme__count">{layout.perLayer} шт. в слое</span>
        {cells.map((cell, index) => (
          <span
            key={index}
            className="mk-scheme__box"
            style={{
              left: `${cell.left}%`,
              top: `${cell.top}%`,
              width: `${cell.width}%`,
              height: `${cell.height}%`,
            }}
          />
        ))}
      </div>
      <figcaption className="mk-scheme__caption">
        <strong>{formatPalletFootprint(length, width)} мм</strong>
        <span>
          {layout.full
            ? "слой закрывает паллету целиком"
            : `остаётся полоса ${layout.leftoverMm} мм`}
        </span>
      </figcaption>
    </figure>
  );
}

export function PalletGuide() {
  const headline = palletLayout(600, 400);
  const perLayer = headline?.perLayer ?? 4;

  return (
    <section
      className="mk-guide seo-home__panel"
      aria-label="Паллетная кратность 1200×800"
    >
      <h2 className="seo-home__h3">
        Паллета {PALLET_LENGTH_MM}×{PALLET_WIDTH_MM}: какие размеры подходят
      </h2>
      <p className="seo-home__p mk-guide__lead">
        Коробка считается паллетной, если все её габариты делят стороны
        поддона {PALLET_LENGTH_MM}×{PALLET_WIDTH_MM} мм без остатка — это
        размеры 100, 200, 300, 400, 600, 800 и 1200 мм. Например, короб
        600×400×400 мм: два вдоль длинной стороны и два вдоль короткой —{" "}
        {perLayer} шт. в слое и ни одного пустого сантиметра. Габариты 350, 500
        или 700 мм ровным слоем на поддон не ложатся: остаётся полоса, которая
        съедает место при хранении и на фулфилменте.
      </p>

      <div className="mk-schemes">
        {SCHEMES.map(([length, width]) => (
          <Scheme key={`${length}x${width}`} length={length} width={width} />
        ))}
      </div>

      <div className="mk-table-wrap">
        <table className="mk-table">
          <caption>
            Сколько коробов ложится на паллету {PALLET_LENGTH_MM}×
            {PALLET_WIDTH_MM} мм в один слой
          </caption>
          <thead>
            <tr>
              <th scope="col">Размер короба, мм</th>
              <th scope="col">Шт. в слое</th>
              <th scope="col">Как ложится</th>
            </tr>
          </thead>
          <tbody>
            {TABLE.map(([length, width, note]) => {
              const layout = palletLayout(length, width);
              return (
                <tr key={`${length}x${width}`}>
                  <th scope="row">{formatPalletFootprint(length, width)}</th>
                  <td className="mk-table__count">
                    {layout ? layout.perLayer : "—"}
                  </td>
                  <td className="mk-table__note">{note}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
