"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import { Search, Save, Loader2, Eye, Pencil, Package } from "lucide-react";

interface MadeToOrderProduct {
  id: string;
  name: string;
  sku: string | null;
  price: number | null;
  madeToOrder: boolean;
  madeToOrderMinQty: number | null;
  isVisible: boolean;
  stockQty: number;
  imageUrl: string | null;
  slug: string;
}

export function MadeToOrderManagerClient({
  products,
  adminPath,
}: {
  products: MadeToOrderProduct[];
  adminPath: string;
}) {
  const [search, setSearch] = useState("");
  const [edits, setEdits] = useState<Record<string, string>>(() => {
    const init: Record<string, string> = {};
    for (const p of products) {
      init[p.id] = p.madeToOrderMinQty != null ? String(p.madeToOrderMinQty) : "";
    }
    return init;
  });
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [savingIds, setSavingIds] = useState<Set<string>>(new Set());

  const filtered = useMemo(() => {
    if (!search.trim()) return products;
    const q = search.toLowerCase();
    return products.filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        (p.sku && p.sku.toLowerCase().includes(q))
    );
  }, [products, search]);

  const hasChanges = useMemo(() => {
    for (const p of products) {
      const original = p.madeToOrderMinQty != null ? String(p.madeToOrderMinQty) : "";
      if ((edits[p.id] ?? "") !== original) return true;
    }
    return false;
  }, [edits, products]);

  async function saveAll() {
    setSaving(true);
    setMessage(null);
    try {
      const payload = products
        .filter((p) => {
          const orig = p.madeToOrderMinQty != null ? String(p.madeToOrderMinQty) : "";
          return (edits[p.id] ?? "") !== orig;
        })
        .map((p) => {
          const raw = edits[p.id];
          const val = raw === "" ? null : Math.max(1, Math.floor(Number(raw) || 0)) || null;
          return { id: p.id, madeToOrderMinQty: val };
        });

      if (payload.length === 0) {
        setMessage("Нет изменений для сохранения");
        setSaving(false);
        return;
      }

      const res = await fetch("/api/admin/products/made-to-order", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ products: payload }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Ошибка сохранения");

      setMessage(`Сохранено ${payload.length} товаров`);
      // обновляем страницу чтобы увидеть новые значения в кэше
      setTimeout(() => window.location.reload(), 800);
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Ошибка сети");
    } finally {
      setSaving(false);
    }
  }

  async function saveOne(id: string) {
    setSavingIds((prev) => new Set(prev).add(id));
    setMessage(null);
    try {
      const raw = edits[id];
      const val = raw === "" ? null : Math.max(1, Math.floor(Number(raw) || 0)) || null;
      const res = await fetch("/api/admin/products/made-to-order", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ products: [{ id, madeToOrderMinQty: val }] }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Ошибка сохранения");
      setMessage(`Товар сохранён: ${val != null ? `от ${val} шт.` : "без минимума"}`);
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Ошибка сети");
    } finally {
      setSavingIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }
  }

  return (
    <div className="admin-stack">
      <div className="admin-card">
        <div className="admin-card__pad" style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
          <div style={{ position: "relative", flex: "1 1 240px" }}>
            <Search size={14} style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", color: "var(--adm-ink-muted)" }} />
            <input
              className="admin-input"
              placeholder="Поиск по названию или артикулу..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              style={{ paddingLeft: 32 }}
            />
          </div>
          <div style={{ fontSize: 12, color: "var(--adm-muted)" }}>
            Всего под заказ: <b>{products.length}</b> · Показано: <b>{filtered.length}</b>
          </div>
          <button
            type="button"
            className="admin-btn admin-btn--primary"
            onClick={saveAll}
            disabled={saving || !hasChanges}
            style={{ marginLeft: "auto" }}
          >
            {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
            Сохранить все изменения
          </button>
          <Link href={`/${adminPath}/products`} className="admin-btn admin-btn--ghost" prefetch={false}>
            К списку товаров
          </Link>
        </div>
      </div>

      {message && (
        <div style={{ padding: "10px 14px", borderRadius: 8, fontSize: 13, background: "rgba(22,163,74,0.08)", border: "1px solid rgba(22,163,74,0.2)", color: "#166534" }}>
          {message}
        </div>
      )}

      <div className="admin-card">
        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead>
              <tr>
                <th style={{ width: 60 }}>Фото</th>
                <th>Товар</th>
                <th style={{ width: 120 }}>Цена</th>
                <th style={{ width: 220 }}>Мин. кол-во под заказ</th>
                <th style={{ width: 160 }}>Действия</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((p) => {
                const isSaving = savingIds.has(p.id);
                const original = p.madeToOrderMinQty != null ? String(p.madeToOrderMinQty) : "";
                const current = edits[p.id] ?? "";
                const changed = current !== original;
                return (
                  <tr key={p.id} style={changed ? { background: "rgba(200,134,10,0.06)" } : undefined}>
                    <td>
                      <div className="admin-product-thumb" style={{ width: 44, height: 44 }}>
                        {p.imageUrl ? <img src={p.imageUrl} alt="" loading="lazy" decoding="async" style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : <Package size={18} />}
                      </div>
                    </td>
                    <td>
                      <div style={{ fontWeight: 600, fontSize: 13 }}>{p.name}</div>
                      <div style={{ fontSize: 11, color: "var(--adm-muted)" }}>
                        {p.sku ? `арт. ${p.sku}` : "без артикула"} · остаток {p.stockQty} шт. {p.isVisible ? "" : "· скрыт"}
                      </div>
                      <div style={{ fontSize: 11, color: "var(--adm-ink-soft)", marginTop: 2 }}>
                        На сайте: Под заказ {current ? `от ${current} шт.` : "(без минимума)"}
                      </div>
                    </td>
                    <td>
                      {p.price != null ? `${p.price.toLocaleString("ru-RU")} ₽` : "по запросу"}
                    </td>
                    <td>
                      <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                        <span style={{ fontSize: 12, color: "var(--adm-muted)" }}>от</span>
                        <input
                          type="number"
                          min={1}
                          step={1}
                          value={current}
                          onChange={(e) => setEdits((prev) => ({ ...prev, [p.id]: e.target.value }))}
                          placeholder="напр. 100"
                          className="admin-input"
                          style={{ width: 110 }}
                        />
                        <span style={{ fontSize: 12 }}>шт.</span>
                      </div>
                      {changed && <div style={{ fontSize: 10, color: "#a16207", marginTop: 4 }}>изменено (было {original || "—"})</div>}
                    </td>
                    <td>
                      <div style={{ display: "flex", gap: 6 }}>
                        <button
                          type="button"
                          className="admin-btn admin-btn--sm admin-btn--primary"
                          disabled={isSaving}
                          onClick={() => saveOne(p.id)}
                        >
                          {isSaving ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />} Сохранить
                        </button>
                        <Link href={`/${adminPath}/products/${p.id}`} className="admin-btn admin-btn--sm admin-btn--ghost" prefetch={false}>
                          <Pencil size={12} /> Карточка
                        </Link>
                        <Link href={`/catalog/product/${p.slug}`} target="_blank" className="admin-btn admin-btn--sm admin-btn--ghost">
                          <Eye size={12} />
                        </Link>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {filtered.length === 0 && (
            <div className="admin-table__empty" style={{ padding: 24, textAlign: "center", color: "var(--adm-muted)" }}>
              {products.length === 0
                ? "Нет товаров с пометкой «Под заказ». Отметьте товар в карточке как «Под заказ» — он появится здесь."
                : "Ничего не найдено по запросу"}
            </div>
          )}
        </div>
      </div>

      <div className="admin-card" style={{ padding: 14, background: "rgba(245,242,234,0.5)" }}>
        <div style={{ fontSize: 12, lineHeight: 1.5, color: "var(--adm-ink-soft)" }}>
          <b>Как это работает:</b> Если у товара стоит галочка «Под заказ», вы можете указать от какого количества изготавливаем.
          <br />
          • На сайте в карточке товара показывается бейдж «Под заказ» и текст «От N шт.» — покупатель понимает минимальный объём.
          <br />
          • В каталоге и на главной в блоке «Товары под заказ» тоже показывается «от N шт.» если задано.
          <br />• Здесь можно массово менять число — введите новое значение и нажмите «Сохранить» или «Сохранить все».
        </div>
      </div>
    </div>
  );
}
