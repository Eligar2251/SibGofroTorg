// =========================================================
// FILE: src/components/admin/WarehouseAssemblies.tsx
// Комплектация и разукомплектация номенклатуры (как в 1С) +
// автоприход выпуска поставкой ПО-… от «СибГофроТорг» по формуле:
//   цена_коробки = (цена_листа_из_последнего_прихода / коробок_с_листа) + 2 ₽
// с возможностью ручной корректировки цены пользователем.
// =========================================================

"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  ArrowLeftRight,
  ArrowRight,
  Boxes,
  Check,
  Copy,
  Loader2,
  Plus,
  RotateCcw,
  Search,
  Sparkles,
  Trash2,
  AlertTriangle,
  X,
} from "lucide-react";
import {
  ProductPicker,
  type PickerProduct,
} from "@/components/admin/ProductPicker";
import { ModalPortal } from "@/components/admin/ModalPortal";
import { useEscapeClose } from "@/hooks/use-escape-close";
import {
  DEFAULT_ASSEMBLY_SURCHARGE_RUB,
  SELF_ASSEMBLY_SUPPLIER_NAME,
  computeStandardBoxUnitCost,
  extractAssemblyPresets,
  roundMoney,
  roundQty,
  type AssemblyOperationKind,
  type AssemblyPreset,
  type LatestSupplierReceiptPrice,
  type WarehouseAssembly,
} from "@/lib/warehouse-assembly";

interface SpentDraftRow {
  rowId: string;
  productId: string;
  quantity: string;
}

interface ProducedDraftRow {
  rowId: string;
  productId: string;
  quantity: string;
  unitPrice: string;
  isManualPrice: boolean;
}

function makeSpentRow(productId = "", quantity = ""): SpentDraftRow {
  return {
    rowId: `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    productId,
    quantity,
  };
}

function makeProducedRow(
  productId = "",
  quantity = "",
  unitPrice = "",
  isManualPrice = false
): ProducedDraftRow {
  return {
    rowId: `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    productId,
    quantity,
    unitPrice,
    isManualPrice,
  };
}

function todayIsoDate(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function fmtNum(v: number): string {
  return (Math.round(v * 1000) / 1000).toLocaleString("ru-RU");
}

function fmtMoney(v: number): string {
  return (Math.round(v * 100) / 100).toLocaleString("ru-RU", {
    minimumFractionDigits: v % 1 !== 0 ? 2 : 0,
    maximumFractionDigits: 2,
  });
}

function fmtDate(iso: string): string {
  if (!iso) return "—";
  const [y, m, d] = iso.slice(0, 10).split("-");
  if (!y || !m || !d) return iso;
  return `${d}.${m}.${y}`;
}

interface AssemblyEditorProps {
  products: PickerProduct[];
  presets: AssemblyPreset[];
  latestSupplierPrices?: Record<string, LatestSupplierReceiptPrice>;
  initialKind?: AssemblyOperationKind;
  initialSpent?: Array<{ productId: string; quantity: number }>;
  initialProduced?: Array<{
    productId: string;
    quantity: number;
    unitPrice?: number | null;
    isManualPrice?: boolean;
  }>;
  initialComment?: string;
  onSuccess: (created: WarehouseAssembly) => void;
  onCancel?: () => void;
}

function AssemblyEditorForm({
  products,
  presets,
  latestSupplierPrices = {},
  initialKind = "assembly",
  initialSpent,
  initialProduced,
  initialComment = "",
  onSuccess,
  onCancel,
}: AssemblyEditorProps) {
  const [kind, setKind] = useState<AssemblyOperationKind>(initialKind);
  const [date, setDate] = useState<string>(todayIsoDate);
  const [spentRows, setSpentRows] = useState<SpentDraftRow[]>(() =>
    initialSpent && initialSpent.length > 0
      ? initialSpent.map((r) => makeSpentRow(r.productId, String(r.quantity)))
      : [makeSpentRow()]
  );
  const [producedRows, setProducedRows] = useState<ProducedDraftRow[]>(() =>
    initialProduced && initialProduced.length > 0
      ? initialProduced.map((r) =>
          makeProducedRow(
            r.productId,
            String(r.quantity),
            r.unitPrice != null && r.isManualPrice ? String(r.unitPrice) : "",
            Boolean(r.isManualPrice)
          )
        )
      : [makeProducedRow()]
  );
  const [boxesPerSheetInput, setBoxesPerSheetInput] = useState<string>(() => {
    if (
      initialSpent?.length === 1 &&
      initialProduced?.length === 1 &&
      initialSpent[0].quantity > 0 &&
      initialProduced[0].quantity > 0
    ) {
      const ratio =
        Math.round(
          (initialProduced[0].quantity / initialSpent[0].quantity) * 10000
        ) / 10000;
      return ratio > 0 ? String(ratio) : "";
    }
    return "";
  });
  const [updatePurchasePrice, setUpdatePurchasePrice] = useState<boolean>(true);
  const [allowNegativeStock, setAllowNegativeStock] = useState<boolean>(false);
  const [comment, setComment] = useState<string>(initialComment);
  const [saving, setSaving] = useState<boolean>(false);
  const [error, setError] = useState<string>("");

  const productsById = useMemo(() => {
    const map = new Map<string, PickerProduct>();
    for (const p of products) map.set(p.id, p);
    return map;
  }, [products]);

  function applyPreset(preset: AssemblyPreset) {
    setKind(preset.kind);
    setSpentRows([
      makeSpentRow(preset.spentProductId, String(preset.lastSpentQty)),
    ]);
    setProducedRows([
      makeProducedRow(preset.producedProductId, String(preset.lastProducedQty)),
    ]);
    setBoxesPerSheetInput(preset.ratio > 0 ? String(preset.ratio) : "");
    setError("");
  }

  function swapSides() {
    setSpentRows(
      producedRows.map((r) => makeSpentRow(r.productId, r.quantity))
    );
    setProducedRows(
      spentRows.map((r) => makeProducedRow(r.productId, r.quantity))
    );
    setKind((prev) => (prev === "assembly" ? "disassembly" : "assembly"));
    setBoxesPerSheetInput((prev) => {
      const n = Number(String(prev).replace(",", "."));
      if (Number.isFinite(n) && n > 0) {
        return String(Math.round((1 / n) * 10000) / 10000);
      }
      return "";
    });
    setError("");
  }

  function handleSpentQtyChange(index: number, nextVal: string) {
    setSpentRows((prev) =>
      prev.map((row, idx) =>
        idx === index ? { ...row, quantity: nextVal } : row
      )
    );
    const ratio = Number(String(boxesPerSheetInput).replace(",", "."));
    if (
      Number.isFinite(ratio) &&
      ratio > 0 &&
      spentRows.length === 1 &&
      producedRows.length === 1 &&
      index === 0
    ) {
      const parsed = Number(String(nextVal).replace(",", "."));
      if (Number.isFinite(parsed) && parsed > 0) {
        const autoOut = roundQty(parsed * ratio);
        setProducedRows((prev) =>
          prev.map((row, idx) =>
            idx === 0 ? { ...row, quantity: String(autoOut) } : row
          )
        );
      }
    }
  }

  function handleBoxesPerSheetChange(nextVal: string) {
    setBoxesPerSheetInput(nextVal);
    const ratio = Number(String(nextVal).replace(",", "."));
    if (
      Number.isFinite(ratio) &&
      ratio > 0 &&
      spentRows.length === 1 &&
      producedRows.length === 1
    ) {
      const spentQty = Number(String(spentRows[0].quantity).replace(",", "."));
      if (Number.isFinite(spentQty) && spentQty > 0) {
        const autoOut = roundQty(spentQty * ratio);
        setProducedRows((prev) =>
          prev.map((row, idx) =>
            idx === 0 ? { ...row, quantity: String(autoOut) } : row
          )
        );
      }
    }
  }

  function handleProducedQtyChange(index: number, nextVal: string) {
    setProducedRows((prev) =>
      prev.map((r, i) => (i === index ? { ...r, quantity: nextVal } : r))
    );
    if (spentRows.length === 1 && producedRows.length === 1 && index === 0) {
      const spentQty = Number(String(spentRows[0].quantity).replace(",", "."));
      const outQty = Number(String(nextVal).replace(",", "."));
      if (
        Number.isFinite(spentQty) &&
        spentQty > 0 &&
        Number.isFinite(outQty) &&
        outQty > 0
      ) {
        const ratio = Math.round((outQty / spentQty) * 10000) / 10000;
        setBoxesPerSheetInput(String(ratio));
      }
    }
  }

  const effectiveSurcharge =
    kind === "assembly" ? DEFAULT_ASSEMBLY_SURCHARGE_RUB : 0;

  // Живой предпросмотр: цена листа из последнего прихода → формула +2 ₽ → приход ПО от СибГофроТорг
  const preview = useMemo(() => {
    let totalSpentCost = 0;
    let hasShortage = false;

    const spentPreview = spentRows.map((row) => {
      const prod = row.productId ? productsById.get(row.productId) || null : null;
      const qty = roundQty(
        Math.max(0, Number(String(row.quantity).replace(",", ".")) || 0)
      );
      const before = prod ? roundQty(Number(prod.stockQty) || 0) : 0;
      const after = roundQty(before - qty);
      if (prod && qty > 0 && after < -1e-6) hasShortage = true;

      const receiptInfo = prod ? latestSupplierPrices[prod.id] || null : null;
      const unitCost =
        receiptInfo && Number(receiptInfo.price) > 0
          ? roundMoney(Number(receiptInfo.price))
          : prod?.purchasePrice != null && Number(prod.purchasePrice) > 0
            ? roundMoney(Number(prod.purchasePrice))
            : null;
      const lineCost =
        unitCost != null && qty > 0 ? roundMoney(unitCost * qty) : 0;
      totalSpentCost = roundMoney(totalSpentCost + lineCost);
      return { prod, qty, before, after, unitCost, lineCost, receiptInfo };
    });

    const totalProducedQty = producedRows.reduce((s, r) => {
      const q = roundQty(
        Math.max(0, Number(String(r.quantity).replace(",", ".")) || 0)
      );
      return s + q;
    }, 0);

    const singleSpent = spentPreview.length === 1 ? spentPreview[0] : null;
    const explicitRatio = Number(String(boxesPerSheetInput).replace(",", "."));

    const producedPreview = producedRows.map((row) => {
      const prod = row.productId ? productsById.get(row.productId) || null : null;
      const qty = roundQty(
        Math.max(0, Number(String(row.quantity).replace(",", ".")) || 0)
      );
      const before = prod ? roundQty(Number(prod.stockQty) || 0) : 0;
      const after = roundQty(before + qty);

      // Выход с 1 листа: либо из явного отношения количеств, либо из поля «С 1 листа получается»
      const ratioForFormula =
        singleSpent && singleSpent.qty > 0 && qty > 0
          ? qty / singleSpent.qty
          : Number.isFinite(explicitRatio) && explicitRatio > 0
            ? explicitRatio
            : null;

      let autoUnitCost: number | null = null;
      if (
        producedRows.length === 1 &&
        singleSpent?.unitCost != null &&
        ratioForFormula != null &&
        ratioForFormula > 0
      ) {
        autoUnitCost = computeStandardBoxUnitCost({
          sheetPrice: singleSpent.unitCost,
          boxesPerSheet: ratioForFormula,
          surchargeRub: effectiveSurcharge,
        });
      } else if (totalSpentCost > 0 && totalProducedQty > 0 && qty > 0) {
        const rawShare =
          producedRows.length === 1
            ? totalSpentCost / qty
            : totalSpentCost / totalProducedQty;
        autoUnitCost = roundMoney(rawShare + effectiveSurcharge);
      }

      const parsedManual = Number(String(row.unitPrice).replace(",", "."));
      const effectiveUnitCost =
        row.isManualPrice &&
        String(row.unitPrice).trim() !== "" &&
        Number.isFinite(parsedManual) &&
        parsedManual >= 0
          ? roundMoney(parsedManual)
          : autoUnitCost;

      const lineCost =
        effectiveUnitCost != null && qty > 0
          ? roundMoney(effectiveUnitCost * qty)
          : 0;

      return {
        prod,
        qty,
        before,
        after,
        autoUnitCost,
        effectiveUnitCost,
        lineCost,
        ratioForFormula:
          ratioForFormula != null
            ? Math.round(ratioForFormula * 10000) / 10000
            : null,
      };
    });

    const totalProducedCost = roundMoney(
      producedPreview.reduce((s, p) => s + p.lineCost, 0)
    );

    return {
      spentPreview,
      producedPreview,
      totalSpentCost,
      totalProducedCost,
      hasShortage,
    };
  }, [
    spentRows,
    producedRows,
    productsById,
    latestSupplierPrices,
    boxesPerSheetInput,
    effectiveSurcharge,
  ]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");

    const spent = spentRows
      .map((r) => ({
        productId: r.productId.trim(),
        quantity: roundQty(Number(String(r.quantity).replace(",", ".")) || 0),
      }))
      .filter((r) => r.productId && r.quantity > 0);

    const produced = producedRows
      .map((r, idx) => {
        const productId = r.productId.trim();
        const quantity = roundQty(
          Number(String(r.quantity).replace(",", ".")) || 0
        );
        const parsedManual = Number(String(r.unitPrice).replace(",", "."));
        const hasManual =
          r.isManualPrice &&
          String(r.unitPrice).trim() !== "" &&
          Number.isFinite(parsedManual) &&
          parsedManual >= 0;
        const finalPrice = hasManual
          ? roundMoney(parsedManual)
          : preview.producedPreview[idx]?.autoUnitCost ?? undefined;
        return {
          productId,
          quantity,
          ...(finalPrice !== undefined ? { unitPrice: finalPrice } : {}),
        };
      })
      .filter((r) => r.productId && r.quantity > 0);

    if (spent.length === 0) {
      setError("Выберите исходный товар и введите потраченное количество");
      return;
    }
    if (produced.length === 0) {
      setError("Выберите получаемую позицию и введите количество выхода");
      return;
    }

    setSaving(true);
    try {
      const res = await fetch("/api/admin/warehouse/assemblies", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind,
          date,
          spent,
          produced,
          updatePurchasePrice,
          allowNegativeStock,
          comment: comment.trim() || null,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || "Не удалось провести комплектацию");
      }
      onSuccess(data.assembly);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Ошибка сохранения");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="wh-assembly-form">
      {/* Быстрые шаблоны / спецификации из истории */}
      {presets.length > 0 && (
        <div
          style={{
            marginBottom: 14,
            padding: "10px 12px",
            borderRadius: 10,
            background: "rgba(44, 94, 79, 0.06)",
            border: "1px solid rgba(44, 94, 79, 0.16)",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              fontSize: 12,
              fontWeight: 600,
              color: "var(--adm-pine-dark, #1f4b3e)",
              marginBottom: 8,
            }}
          >
            <Sparkles size={13} />
            Быстрые связки из прошлых комплектаций (заполнить в 1 клик):
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {presets.map((p) => (
              <button
                key={p.key}
                type="button"
                className="admin-btn admin-btn--outline admin-btn--sm"
                style={{ fontSize: 12, padding: "4px 10px" }}
                onClick={() => applyPreset(p)}
                title={`Последний раз: ${fmtNum(p.lastSpentQty)} → ${fmtNum(p.lastProducedQty)} шт. (с 1 ед. ×${p.ratio})`}
              >
                {p.spentProductName} → {p.producedProductName}{" "}
                <span className="admin-muted" style={{ marginLeft: 4 }}>
                  ({fmtNum(p.lastSpentQty)}→{fmtNum(p.lastProducedQty)})
                </span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Верхняя полоса режима + дата + кнопка разворота ⇄ */}
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 10,
          marginBottom: 14,
        }}
      >
        <div className="admin-filters admin-filters--sub" style={{ margin: 0 }}>
          <button
            type="button"
            onClick={() => setKind("assembly")}
            className={`admin-filter${kind === "assembly" ? " admin-filter--active" : ""}`}
          >
            Комплектация (лист → коробки)
          </button>
          <button
            type="button"
            onClick={() => setKind("disassembly")}
            className={`admin-filter${kind === "disassembly" ? " admin-filter--active" : ""}`}
          >
            Разукомплектация
          </button>
        </div>

        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            flexWrap: "wrap",
          }}
        >
          <button
            type="button"
            className="admin-btn admin-btn--ghost admin-btn--sm"
            onClick={swapSides}
            title="Поменять местами исходный и получаемый товары"
          >
            <ArrowLeftRight size={14} />
            Поменять местами
          </button>
          <label
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              fontSize: 12.5,
              color: "var(--adm-muted, #666)",
            }}
          >
            Дата:
            <input
              type="date"
              className="admin-input"
              style={{ width: 145, padding: "5px 8px" }}
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
          </label>
        </div>
      </div>

      {/* Две наглядные колонки: ЧТО ТРАТИМ → ЧТО ПОЛУЧАЕМ (приход от СибГофроТорг) */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(290px, 1fr))",
          gap: 14,
          alignItems: "stretch",
        }}
      >
        {/* ЛЕВАЯ КОЛОНКА: ИСХОДНЫЙ ТОВАР (СПИСАНИЕ ЛИСТОВ) */}
        <div
          style={{
            padding: 14,
            borderRadius: 12,
            border: "1px solid rgba(180, 95, 50, 0.28)",
            background: "rgba(180, 95, 50, 0.035)",
            display: "flex",
            flexDirection: "column",
            gap: 10,
          }}
        >
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
            }}
          >
            <div>
              <strong
                style={{ fontSize: 14, color: "var(--adm-rust-dark, #7c3518)" }}
              >
                1. Что тратим со склада
              </strong>
              <div style={{ fontSize: 12, color: "var(--adm-muted, #666)" }}>
                Цена листа подтягивается с последнего прихода поставщика
              </div>
            </div>
            <span className="admin-badge admin-badge--amber">− Списание</span>
          </div>

          {spentRows.map((row, idx) => {
            const pInfo = preview.spentPreview[idx];
            return (
              <div
                key={row.rowId}
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: 8,
                  paddingTop: idx > 0 ? 10 : 0,
                  borderTop: idx > 0 ? "1px dashed rgba(0,0,0,0.1)" : "none",
                }}
              >
                <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    {pInfo?.prod ? (
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "space-between",
                          gap: 8,
                          padding: "8px 10px",
                          borderRadius: 8,
                          background: "var(--adm-surface, #fff)",
                          border:
                            "1px solid var(--adm-border, rgba(0,0,0,0.12))",
                        }}
                      >
                        <div style={{ minWidth: 0 }}>
                          <div style={{ fontWeight: 600, fontSize: 13.5 }}>
                            {pInfo.prod.name}
                          </div>
                          <div
                            style={{
                              fontSize: 11.5,
                              color: "var(--adm-muted, #666)",
                            }}
                          >
                            {pInfo.prod.sku ? `Арт. ${pInfo.prod.sku} · ` : ""}
                            На складе сейчас: <b>{fmtNum(pInfo.before)} шт.</b>
                          </div>
                        </div>
                        <button
                          type="button"
                          className="admin-btn admin-btn--ghost admin-btn--sm"
                          onClick={() => {
                            setSpentRows((prev) =>
                              prev.map((r, i) =>
                                i === idx ? { ...r, productId: "" } : r
                              )
                            );
                          }}
                          title="Выбрать другой товар"
                        >
                          Сменить
                        </button>
                      </div>
                    ) : (
                      <ProductPicker
                        products={products}
                        onPick={(picked) => {
                          setSpentRows((prev) =>
                            prev.map((r, i) =>
                              i === idx ? { ...r, productId: picked.id } : r
                            )
                          );
                        }}
                        placeholder="Выберите исходный товар (напр. лист картона)…"
                      />
                    )}
                  </div>
                  {spentRows.length > 1 && (
                    <button
                      type="button"
                      className="admin-btn admin-btn--ghost admin-btn--sm"
                      onClick={() =>
                        setSpentRows((prev) => prev.filter((_, i) => i !== idx))
                      }
                      title="Убрать строку"
                    >
                      <X size={14} />
                    </button>
                  )}
                </div>

                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    flexWrap: "wrap",
                  }}
                >
                  <label style={{ fontSize: 12.5, fontWeight: 600 }}>
                    Потрачено, шт.:
                  </label>
                  <input
                    type="number"
                    min="0"
                    step="any"
                    inputMode="decimal"
                    className="admin-input"
                    style={{ width: 120, fontWeight: 700 }}
                    placeholder="Напр. 100"
                    value={row.quantity}
                    onChange={(e) => handleSpentQtyChange(idx, e.target.value)}
                  />
                  {pInfo?.prod && (
                    <span
                      style={{
                        fontSize: 12,
                        color:
                          pInfo.after < -1e-6
                            ? "var(--adm-rust, #b83a24)"
                            : "var(--adm-muted, #555)",
                        fontWeight: pInfo.after < -1e-6 ? 600 : 400,
                      }}
                    >
                      Склад: {fmtNum(pInfo.before)} →{" "}
                      <b>{fmtNum(pInfo.after)} шт.</b>
                    </span>
                  )}
                </div>

                {spentRows.length === 1 &&
                  producedRows.length === 1 &&
                  idx === 0 && (
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 8,
                        flexWrap: "wrap",
                      }}
                    >
                      <label
                        style={{
                          fontSize: 12,
                          color: "var(--adm-muted, #555)",
                        }}
                      >
                        Коробок с 1 листа:
                      </label>
                      <input
                        type="number"
                        min="0"
                        step="any"
                        inputMode="decimal"
                        className="admin-input"
                        style={{ width: 95, padding: "4px 8px", fontSize: 12.5 }}
                        placeholder="Напр. 3"
                        value={boxesPerSheetInput}
                        onChange={(e) =>
                          handleBoxesPerSheetChange(e.target.value)
                        }
                      />
                      <span
                        style={{ fontSize: 11.5, color: "var(--adm-muted)" }}
                      >
                        шт./лист
                      </span>
                    </div>
                  )}

                {pInfo?.prod && pInfo.unitCost != null && (
                  <div
                    style={{
                      fontSize: 11.5,
                      color: "var(--adm-muted, #555)",
                      background: "rgba(180, 95, 50, 0.07)",
                      padding: "5px 8px",
                      borderRadius: 6,
                    }}
                  >
                    {pInfo.receiptInfo?.source === "receipt" ? (
                      <>
                        Цена с последнего прихода{" "}
                        <b>
                          {pInfo.receiptInfo.receiptNumber
                            ? `ПО-${pInfo.receiptInfo.receiptNumber}`
                            : "поставщика"}
                        </b>
                        {pInfo.receiptInfo.supplier
                          ? ` (${pInfo.receiptInfo.supplier})`
                          : ""}
                        {pInfo.receiptInfo.receiptDate
                          ? ` от ${fmtDate(pInfo.receiptInfo.receiptDate)}`
                          : ""}
                        : <b>{fmtMoney(pInfo.unitCost)} ₽/шт.</b>
                      </>
                    ) : (
                      <>
                        Цена из карточки товара:{" "}
                        <b>{fmtMoney(pInfo.unitCost)} ₽/шт.</b>
                      </>
                    )}
                    {pInfo.qty > 0 && (
                      <>
                        {" "}
                        · всего сырья на <b>{fmtMoney(pInfo.lineCost)} ₽</b>
                      </>
                    )}
                  </div>
                )}
              </div>
            );
          })}

          <div>
            <button
              type="button"
              className="admin-btn admin-btn--ghost admin-btn--sm"
              style={{ fontSize: 12 }}
              onClick={() => {
                setBoxesPerSheetInput("");
                setSpentRows((prev) => [...prev, makeSpentRow()]);
              }}
            >
              <Plus size={13} /> Ещё комплектующая
            </button>
          </div>
        </div>

        {/* ПРАВАЯ КОЛОНКА: ПОЛУЧАЕМЫЙ ТОВАР (ПРИХОД ОТ СИБГОФРОТОРГ) */}
        <div
          style={{
            padding: 14,
            borderRadius: 12,
            border: "1px solid rgba(44, 94, 79, 0.3)",
            background: "rgba(44, 94, 79, 0.04)",
            display: "flex",
            flexDirection: "column",
            gap: 10,
          }}
        >
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              gap: 8,
            }}
          >
            <div>
              <strong
                style={{ fontSize: 14, color: "var(--adm-pine-dark, #1f4b3e)" }}
              >
                2. Что ставим на приход ({SELF_ASSEMBLY_SUPPLIER_NAME})
              </strong>
              <div style={{ fontSize: 12, color: "var(--adm-muted, #666)" }}>
                Создастся проведённая поставка ПО-… от «{SELF_ASSEMBLY_SUPPLIER_NAME}»
              </div>
            </div>
            <span className="admin-badge admin-badge--green">
              + Поставка ПО
            </span>
          </div>

          {producedRows.map((row, idx) => {
            const pInfo = preview.producedPreview[idx];
            const singleSheetPrice =
              preview.spentPreview.length === 1
                ? preview.spentPreview[0]?.unitCost ?? null
                : null;
            const displayedPrice = row.isManualPrice
              ? row.unitPrice
              : pInfo?.autoUnitCost != null
                ? String(pInfo.autoUnitCost)
                : "";

            return (
              <div
                key={row.rowId}
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: 8,
                  paddingTop: idx > 0 ? 10 : 0,
                  borderTop: idx > 0 ? "1px dashed rgba(0,0,0,0.1)" : "none",
                }}
              >
                <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    {pInfo?.prod ? (
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "space-between",
                          gap: 8,
                          padding: "8px 10px",
                          borderRadius: 8,
                          background: "var(--adm-surface, #fff)",
                          border:
                            "1px solid var(--adm-border, rgba(0,0,0,0.12))",
                        }}
                      >
                        <div style={{ minWidth: 0 }}>
                          <div style={{ fontWeight: 600, fontSize: 13.5 }}>
                            {pInfo.prod.name}
                          </div>
                          <div
                            style={{
                              fontSize: 11.5,
                              color: "var(--adm-muted, #666)",
                            }}
                          >
                            {pInfo.prod.sku ? `Арт. ${pInfo.prod.sku} · ` : ""}
                            На складе сейчас: <b>{fmtNum(pInfo.before)} шт.</b>
                          </div>
                        </div>
                        <button
                          type="button"
                          className="admin-btn admin-btn--ghost admin-btn--sm"
                          onClick={() => {
                            setProducedRows((prev) =>
                              prev.map((r, i) =>
                                i === idx
                                  ? {
                                      ...r,
                                      productId: "",
                                      unitPrice: "",
                                      isManualPrice: false,
                                    }
                                  : r
                              )
                            );
                          }}
                          title="Выбрать другой товар"
                        >
                          Сменить
                        </button>
                      </div>
                    ) : (
                      <ProductPicker
                        products={products}
                        onPick={(picked) => {
                          setProducedRows((prev) =>
                            prev.map((r, i) =>
                              i === idx ? { ...r, productId: picked.id } : r
                            )
                          );
                        }}
                        placeholder="Выберите получаемую позицию (напр. коробка)…"
                      />
                    )}
                  </div>
                  {producedRows.length > 1 && (
                    <button
                      type="button"
                      className="admin-btn admin-btn--ghost admin-btn--sm"
                      onClick={() =>
                        setProducedRows((prev) =>
                          prev.filter((_, i) => i !== idx)
                        )
                      }
                      title="Убрать строку"
                    >
                      <X size={14} />
                    </button>
                  )}
                </div>

                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    flexWrap: "wrap",
                  }}
                >
                  <label style={{ fontSize: 12.5, fontWeight: 600 }}>
                    Получится, шт.:
                  </label>
                  <input
                    type="number"
                    min="0"
                    step="any"
                    inputMode="decimal"
                    className="admin-input"
                    style={{ width: 115, fontWeight: 700 }}
                    placeholder="Напр. 300"
                    value={row.quantity}
                    onChange={(e) =>
                      handleProducedQtyChange(idx, e.target.value)
                    }
                  />
                  {pInfo?.prod && (
                    <span
                      style={{
                        fontSize: 12,
                        color: "var(--adm-pine-dark, #1f4b3e)",
                      }}
                    >
                      Склад: {fmtNum(pInfo.before)} →{" "}
                      <b>{fmtNum(pInfo.after)} шт.</b>
                    </span>
                  )}
                </div>

                {/* Редактируемая цена прихода с автоформулой (цена листа / выход + 2 ₽) */}
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    flexWrap: "wrap",
                  }}
                >
                  <label style={{ fontSize: 12.5, fontWeight: 600 }}>
                    Цена прихода (себестоимость), ₽/шт.:
                  </label>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    inputMode="decimal"
                    className="admin-input"
                    style={{ width: 120, fontWeight: 700 }}
                    placeholder="Авто по формуле"
                    value={displayedPrice}
                    onChange={(e) => {
                      const val = e.target.value;
                      setProducedRows((prev) =>
                        prev.map((r, i) =>
                          i === idx
                            ? {
                                ...r,
                                unitPrice: val,
                                isManualPrice: val.trim() !== "",
                              }
                            : r
                        )
                      );
                    }}
                  />
                  {row.isManualPrice && pInfo?.autoUnitCost != null && (
                    <button
                      type="button"
                      className="admin-btn admin-btn--ghost admin-btn--sm"
                      style={{ fontSize: 11.5, padding: "3px 8px" }}
                      onClick={() =>
                        setProducedRows((prev) =>
                          prev.map((r, i) =>
                            i === idx
                              ? { ...r, unitPrice: "", isManualPrice: false }
                              : r
                          )
                        )
                      }
                      title="Вернуть автоматический расчёт по стандартной формуле"
                    >
                      ↺ Авто ({fmtMoney(pInfo.autoUnitCost)} ₽)
                    </button>
                  )}
                </div>

                {(pInfo?.effectiveUnitCost != null ||
                  pInfo?.autoUnitCost != null) && (
                  <div
                    style={{
                      fontSize: 12,
                      color: "var(--adm-pine-dark, #1f4b3e)",
                      background: "rgba(44, 94, 79, 0.08)",
                      padding: "6px 9px",
                      borderRadius: 6,
                      lineHeight: 1.4,
                    }}
                  >
                    {row.isManualPrice ? (
                      <>
                        Указана своя цена прихода:{" "}
                        <b>
                          {fmtMoney(pInfo.effectiveUnitCost ?? 0)} ₽/шт.
                        </b>
                        {pInfo.qty > 0 && (
                          <> · сумма ПО: <b>{fmtMoney(pInfo.lineCost)} ₽</b></>
                        )}
                      </>
                    ) : singleSheetPrice != null &&
                      pInfo?.ratioForFormula != null &&
                      producedRows.length === 1 ? (
                      <>
                        Формула:{" "}
                        <b>{fmtMoney(singleSheetPrice)} ₽</b> (лист) ÷{" "}
                        <b>{fmtNum(pInfo.ratioForFormula)}</b> шт./лист
                        {effectiveSurcharge > 0
                          ? ` + ${fmtMoney(effectiveSurcharge)} ₽`
                          : ""}{" "}
                        = <b>{fmtMoney(pInfo.autoUnitCost ?? 0)} ₽/шт.</b>
                        {pInfo.qty > 0 && (
                          <> · сумма ПО: <b>{fmtMoney(pInfo.lineCost)} ₽</b></>
                        )}
                      </>
                    ) : (
                      <>
                        Себестоимость 1 ед.:{" "}
                        <b>{fmtMoney(pInfo?.effectiveUnitCost ?? 0)} ₽/шт.</b>
                        {pInfo?.qty ? (
                          <> · сумма ПО: <b>{fmtMoney(pInfo.lineCost)} ₽</b></>
                        ) : null}
                      </>
                    )}
                  </div>
                )}
              </div>
            );
          })}

          <div>
            <button
              type="button"
              className="admin-btn admin-btn--ghost admin-btn--sm"
              style={{ fontSize: 12 }}
              onClick={() => {
                setBoxesPerSheetInput("");
                setProducedRows((prev) => [...prev, makeProducedRow()]);
              }}
            >
              <Plus size={13} /> Ещё выходная позиция
            </button>
          </div>
        </div>
      </div>

      {/* Опции себестоимости, отрицательного остатка и комментарий */}
      <div
        style={{
          marginTop: 14,
          display: "flex",
          flexDirection: "column",
          gap: 10,
        }}
      >
        <div style={{ display: "flex", flexWrap: "wrap", gap: 16 }}>
          {preview.totalProducedCost > 0 && (
            <label
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 7,
                fontSize: 12.5,
                cursor: "pointer",
              }}
            >
              <input
                type="checkbox"
                checked={updatePurchasePrice}
                onChange={(e) => setUpdatePurchasePrice(e.target.checked)}
              />
              Обновить закупочную цену в карточке получаемого товара
            </label>
          )}

          {(preview.hasShortage || allowNegativeStock) && (
            <label
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 7,
                fontSize: 12.5,
                cursor: "pointer",
                color: "var(--adm-rust-dark, #7c3518)",
              }}
            >
              <input
                type="checkbox"
                checked={allowNegativeStock}
                onChange={(e) => setAllowNegativeStock(e.target.checked)}
              />
              Разрешить списание в минус (если поступление сырья ещё не проведено)
            </label>
          )}
        </div>

        <input
          type="text"
          className="admin-input"
          placeholder="Комментарий (необязательно — например: раскрой партии под заказ, смена №2)…"
          value={comment}
          onChange={(e) => setComment(e.target.value)}
        />
      </div>

      {error && (
        <div
          style={{
            marginTop: 12,
            padding: "9px 12px",
            borderRadius: 8,
            background: "rgba(184, 58, 36, 0.1)",
            color: "var(--adm-rust-dark, #7c2214)",
            display: "flex",
            alignItems: "center",
            gap: 8,
            fontSize: 13,
          }}
        >
          <AlertTriangle size={15} />
          <span>{error}</span>
        </div>
      )}

      <div
        style={{
          marginTop: 16,
          display: "flex",
          justifyContent: "flex-end",
          gap: 8,
          flexWrap: "wrap",
        }}
      >
        {onCancel && (
          <button
            type="button"
            className="admin-btn admin-btn--ghost"
            onClick={onCancel}
            disabled={saving}
          >
            Отмена
          </button>
        )}
        <button
          type="submit"
          className="admin-btn admin-btn--primary"
          disabled={saving}
        >
          {saving ? <Loader2 size={15} className="spin" /> : <Check size={15} />}
          {kind === "disassembly"
            ? "Провести разукомплектацию"
            : `Провести и поставить на приход (${SELF_ASSEMBLY_SUPPLIER_NAME})`}
        </button>
      </div>
    </form>
  );
}

/**
 * Быстрая кнопка «Комплектация (1С)» прямо на панели вкладки «Склад»
 * (рядом с «Ревизия склада»), чтобы превращать листы в коробки не уходя со склада.
 */
export function QuickAssemblyButton({
  products,
  initialAssemblies = [],
}: {
  products: PickerProduct[];
  initialAssemblies?: WarehouseAssembly[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [assemblies, setAssemblies] =
    useState<WarehouseAssembly[]>(initialAssemblies);
  const [latestSupplierPrices, setLatestSupplierPrices] = useState<
    Record<string, LatestSupplierReceiptPrice>
  >({});
  const [doneBanner, setDoneBanner] = useState<string>("");

  useEscapeClose(() => setOpen(false), open);

  useEffect(() => {
    if (initialAssemblies.length > 0) {
      setAssemblies(initialAssemblies);
    }
  }, [initialAssemblies]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    fetch("/api/admin/warehouse/assemblies")
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (cancelled || !data) return;
        if (Array.isArray(data.assemblies)) {
          setAssemblies(data.assemblies);
        }
        if (
          data.latestSupplierPrices &&
          typeof data.latestSupplierPrices === "object"
        ) {
          setLatestSupplierPrices(data.latestSupplierPrices);
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [open]);

  const presets = useMemo(
    () => extractAssemblyPresets(assemblies),
    [assemblies]
  );

  return (
    <>
      <button
        type="button"
        className="admin-btn admin-btn--outline"
        onClick={() => setOpen(true)}
        title="Комплектация номенклатуры (1С): быстро превратить листы в коробки с автоприходом от СибГофроТорг"
      >
        <Boxes size={15} />
        Комплектация (1С)
      </button>

      {doneBanner && (
        <span
          className="admin-badge admin-badge--green"
          style={{ marginLeft: 6 }}
        >
          <Check size={11} /> {doneBanner}
        </span>
      )}

      {open && (
        <ModalPortal>
          <div className="admin-modal-overlay" data-admin="true">
            <div
              className="admin-modal wh-modal"
              style={{ maxWidth: 860, width: "96vw" }}
              onClick={(e) => e.stopPropagation()}
            >
              <div className="admin-modal__head">
                <h3 className="admin-modal__title">
                  Комплектация номенклатуры (1С)
                </h3>
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="admin-modal__close"
                  aria-label="Закрыть"
                >
                  <X size={14} />
                </button>
              </div>
              <div className="admin-modal__body" style={{ padding: 18 }}>
                <AssemblyEditorForm
                  products={products}
                  presets={presets}
                  latestSupplierPrices={latestSupplierPrices}
                  onCancel={() => setOpen(false)}
                  onSuccess={(created) => {
                    setAssemblies((prev) => [created, ...prev]);
                    setOpen(false);
                    setDoneBanner(
                      `КМП-${created.number}${
                        created.linkedReceiptNumber
                          ? ` · ПО-${created.linkedReceiptNumber}`
                          : ""
                      } проведена`
                    );
                    window.setTimeout(() => setDoneBanner(""), 5000);
                    router.refresh();
                  }}
                />
              </div>
            </div>
          </div>
        </ModalPortal>
      )}
    </>
  );
}

/**
 * Полноценная вкладка «Комплектация» в разделе «Учёт и склад»:
 * форма быстрого проведения + журнал всех документов КМП-… с повтором и сторно.
 */
export function WarehouseAssemblies({
  assemblies: initialAssemblies,
  products,
  quickOpen = false,
  onQuickActionHandled,
}: {
  assemblies: WarehouseAssembly[];
  products: PickerProduct[];
  quickOpen?: boolean;
  onQuickActionHandled?: () => void;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const highlightedId = searchParams.get("assembly");

  const [docs, setDocs] = useState<WarehouseAssembly[]>(initialAssemblies);
  const [latestSupplierPrices, setLatestSupplierPrices] = useState<
    Record<string, LatestSupplierReceiptPrice>
  >({});
  const [showCreateForm, setShowCreateForm] = useState<boolean>(
    () => quickOpen || initialAssemblies.length === 0
  );
  const [repeatSeed, setRepeatSeed] = useState<{
    key: number;
    kind: AssemblyOperationKind;
    spent: Array<{ productId: string; quantity: number }>;
    produced: Array<{
      productId: string;
      quantity: number;
      unitPrice?: number | null;
      isManualPrice?: boolean;
    }>;
    comment: string;
  } | null>(null);

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<
    "all" | "posted" | "cancelled"
  >("all");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string>("");
  const [successNote, setSuccessNote] = useState<string>("");

  useEffect(() => {
    setDocs(initialAssemblies);
  }, [initialAssemblies]);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/admin/warehouse/assemblies")
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (cancelled || !data) return;
        if (
          data.latestSupplierPrices &&
          typeof data.latestSupplierPrices === "object"
        ) {
          setLatestSupplierPrices(data.latestSupplierPrices);
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (quickOpen) {
      setShowCreateForm(true);
      onQuickActionHandled?.();
    }
  }, [quickOpen, onQuickActionHandled]);

  const presets = useMemo(() => extractAssemblyPresets(docs), [docs]);

  const filteredDocs = useMemo(() => {
    const q = search.trim().toLowerCase();
    return docs.filter((doc) => {
      if (statusFilter !== "all" && doc.status !== statusFilter) return false;
      if (!q) return true;
      const numLabel = `кмп-${doc.number}`;
      const poLabel = doc.linkedReceiptNumber
        ? `по-${doc.linkedReceiptNumber}`
        : "";
      const spentMatch = doc.spentItems.some(
        (i) =>
          i.name.toLowerCase().includes(q) ||
          (i.sku && i.sku.toLowerCase().includes(q))
      );
      const prodMatch = doc.producedItems.some(
        (i) =>
          i.name.toLowerCase().includes(q) ||
          (i.sku && i.sku.toLowerCase().includes(q))
      );
      return (
        numLabel.includes(q) ||
        (poLabel && poLabel.includes(q)) ||
        String(doc.number) === q ||
        spentMatch ||
        prodMatch ||
        Boolean(doc.comment && doc.comment.toLowerCase().includes(q))
      );
    });
  }, [docs, search, statusFilter]);

  const handleCancelAssembly = useCallback(
    async (doc: WarehouseAssembly) => {
      if (
        !confirm(
          `Отменить проведение КМП-${doc.number}${
            doc.linkedReceiptNumber
              ? ` (и связанный приход ПО-${doc.linkedReceiptNumber} от «${SELF_ASSEMBLY_SUPPLIER_NAME}»)`
              : ""
          }? Потраченные товары вернутся на склад, а выпущенные позиции спишутся обратно.`
        )
      ) {
        return;
      }
      setBusyId(doc.id);
      setActionError("");
      try {
        const res = await fetch(`/api/admin/warehouse/assemblies/${doc.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "cancel" }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || "Ошибка отмены");
        setDocs((prev) =>
          prev.map((d) => (d.id === doc.id ? data.assembly : d))
        );
        setSuccessNote(
          `Комплектация КМП-${doc.number} отменена, остатки возвращены`
        );
        window.setTimeout(() => setSuccessNote(""), 4000);
        router.refresh();
      } catch (e) {
        setActionError(e instanceof Error ? e.message : "Ошибка сети");
      } finally {
        setBusyId(null);
      }
    },
    [router]
  );

  const handleDeleteAssembly = useCallback(
    async (doc: WarehouseAssembly) => {
      const msg =
        doc.status === "posted"
          ? `Удалить проведённую КМП-${doc.number}? Складские движения и связанная поставка будут сторнированы, а документ удалён.`
          : `Удалить отменённый документ КМП-${doc.number}?`;
      if (!confirm(msg)) return;
      setBusyId(doc.id);
      setActionError("");
      try {
        const res = await fetch(`/api/admin/warehouse/assemblies/${doc.id}`, {
          method: "DELETE",
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || "Ошибка удаления");
        setDocs((prev) => prev.filter((d) => d.id !== doc.id));
        router.refresh();
      } catch (e) {
        setActionError(e instanceof Error ? e.message : "Ошибка сети");
      } finally {
        setBusyId(null);
      }
    },
    [router]
  );

  function handleRepeat(doc: WarehouseAssembly) {
    setRepeatSeed({
      key: Date.now(),
      kind: doc.kind,
      spent: doc.spentItems.map((i) => ({
        productId: i.productId,
        quantity: i.quantity,
      })),
      produced: doc.producedItems.map((i) => ({
        productId: i.productId,
        quantity: i.quantity,
        unitPrice: i.unitCost,
        isManualPrice: Boolean(i.isManualPrice),
      })),
      comment: doc.comment || "",
    });
    setShowCreateForm(true);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {/* Шапка раздела */}
      <div
        className="admin-card"
        style={{
          padding: "14px 18px",
          display: "flex",
          flexWrap: "wrap",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
        }}
      >
        <div>
          <h2 style={{ margin: 0, fontSize: 17, fontWeight: 700 }}>
            Комплектация номенклатуры (1С)
          </h2>
          <p
            style={{
              margin: "3px 0 0",
              fontSize: 13,
              color: "var(--adm-muted, #666)",
            }}
          >
            Списание листа и автоприход коробок поставкой от «
            {SELF_ASSEMBLY_SUPPLIER_NAME}» по формуле{" "}
            <b>(цена листа с последнего прихода ÷ коробок с листа) + 2 ₽</b>{" "}
            или вашей цене.
          </p>
        </div>

        <button
          type="button"
          className={`admin-btn ${
            showCreateForm ? "admin-btn--ghost" : "admin-btn--primary"
          }`}
          onClick={() => {
            setRepeatSeed(null);
            setShowCreateForm((v) => !v);
          }}
        >
          {showCreateForm ? (
            <>
              <X size={15} /> Скрыть форму
            </>
          ) : (
            <>
              <Plus size={15} /> Новая комплектация
            </>
          )}
        </button>
      </div>

      {successNote && (
        <div
          style={{
            padding: "10px 14px",
            borderRadius: 10,
            background: "rgba(44, 94, 79, 0.1)",
            color: "var(--adm-pine-dark, #1f4b3e)",
            display: "flex",
            alignItems: "center",
            gap: 8,
            fontSize: 13.5,
            fontWeight: 600,
          }}
        >
          <Check size={16} />
          <span>{successNote}</span>
        </div>
      )}

      {actionError && (
        <div
          style={{
            padding: "10px 14px",
            borderRadius: 10,
            background: "rgba(184, 58, 36, 0.1)",
            color: "var(--adm-rust-dark, #7c2214)",
            display: "flex",
            alignItems: "center",
            gap: 8,
            fontSize: 13.5,
          }}
        >
          <AlertTriangle size={16} />
          <span>{actionError}</span>
        </div>
      )}

      {/* Форма создания / проведения */}
      {showCreateForm && (
        <div className="admin-card" style={{ padding: 18 }}>
          <AssemblyEditorForm
            key={repeatSeed ? `seed_${repeatSeed.key}` : "fresh"}
            products={products}
            presets={presets}
            latestSupplierPrices={latestSupplierPrices}
            initialKind={repeatSeed?.kind ?? "assembly"}
            initialSpent={repeatSeed?.spent}
            initialProduced={repeatSeed?.produced}
            initialComment={repeatSeed?.comment ?? ""}
            onCancel={
              docs.length > 0 ? () => setShowCreateForm(false) : undefined
            }
            onSuccess={(created) => {
              setDocs((prev) => [created, ...prev]);
              setRepeatSeed(null);
              setShowCreateForm(false);
              setSuccessNote(
                `КМП-${created.number}${
                  created.linkedReceiptNumber
                    ? ` (поставка ПО-${created.linkedReceiptNumber} от «${SELF_ASSEMBLY_SUPPLIER_NAME}»)`
                    : ""
                } проведена: списано ${created.spentItems
                  .map((s) => `${s.name} (${fmtNum(s.quantity)} шт.)`)
                  .join(", ")} → оприходовано ${created.producedItems
                  .map(
                    (p) =>
                      `${p.name} (${fmtNum(p.quantity)} шт.${
                        p.unitCost != null
                          ? ` по ${fmtMoney(p.unitCost)} ₽`
                          : ""
                      })`
                  )
                  .join(", ")}`
              );
              window.setTimeout(() => setSuccessNote(""), 6500);
              router.refresh();
            }}
          />
        </div>
      )}

      {/* Фильтры и журнал проведённых комплектаций */}
      <div className="admin-card" style={{ padding: 16 }}>
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 10,
            marginBottom: 14,
          }}
        >
          <div
            className="admin-search"
            style={{ flex: "1 1 240px", maxWidth: 380 }}
          >
            <Search size={14} className="admin-search__icon" />
            <input
              type="text"
              placeholder="Поиск по КМП/ПО-номеру, товару, артикулу…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>

          <div
            className="admin-filters admin-filters--sub"
            style={{ margin: 0 }}
          >
            <button
              type="button"
              onClick={() => setStatusFilter("all")}
              className={`admin-filter${
                statusFilter === "all" ? " admin-filter--active" : ""
              }`}
            >
              Все ({docs.length})
            </button>
            <button
              type="button"
              onClick={() => setStatusFilter("posted")}
              className={`admin-filter${
                statusFilter === "posted" ? " admin-filter--active" : ""
              }`}
            >
              Проведённые ({docs.filter((d) => d.status === "posted").length})
            </button>
            <button
              type="button"
              onClick={() => setStatusFilter("cancelled")}
              className={`admin-filter${
                statusFilter === "cancelled" ? " admin-filter--active" : ""
              }`}
            >
              Отменённые ({docs.filter((d) => d.status === "cancelled").length})
            </button>
          </div>
        </div>

        {filteredDocs.length === 0 ? (
          <div
            style={{
              padding: "28px 16px",
              textAlign: "center",
              color: "var(--adm-muted, #666)",
              fontSize: 13.5,
            }}
          >
            {docs.length === 0
              ? "Комплектаций пока не было. Выберите исходный товар и выходную позицию выше, чтобы провести первую КМП-1."
              : "По заданному фильтру документов не найдено."}
          </div>
        ) : (
          <div className="admin-table-wrap">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>Документ</th>
                  <th>Дата</th>
                  <th>Потрачено (расход −)</th>
                  <th></th>
                  <th>Поставлено на приход (+)</th>
                  <th style={{ textAlign: "right" }}>Сумма прихода</th>
                  <th>Статус</th>
                  <th style={{ textAlign: "right" }}>Действия</th>
                </tr>
              </thead>
              <tbody>
                {filteredDocs.map((doc) => {
                  const isHighlighted = highlightedId === doc.id;
                  const isCancelled = doc.status === "cancelled";
                  const outSum =
                    doc.producedTotalCost != null && doc.producedTotalCost > 0
                      ? doc.producedTotalCost
                      : doc.totalCost;
                  return (
                    <tr
                      key={doc.id}
                      style={{
                        opacity: isCancelled ? 0.62 : 1,
                        background: isHighlighted
                          ? "rgba(44, 94, 79, 0.1)"
                          : undefined,
                      }}
                    >
                      <td>
                        <strong>КМП-{doc.number}</strong>
                        <div
                          style={{
                            fontSize: 11,
                            color: "var(--adm-muted, #666)",
                          }}
                        >
                          {doc.kind === "disassembly"
                            ? "Разукомплектация"
                            : "Комплектация"}
                        </div>
                        {doc.linkedReceiptNumber && (
                          <div style={{ marginTop: 3 }}>
                            <span
                              className="admin-badge admin-badge--green"
                              style={{ fontSize: 10.5 }}
                              title={`Автоматическая поставка от «${SELF_ASSEMBLY_SUPPLIER_NAME}»`}
                            >
                              ПО-{doc.linkedReceiptNumber} ·{" "}
                              {SELF_ASSEMBLY_SUPPLIER_NAME}
                            </span>
                          </div>
                        )}
                      </td>
                      <td>{fmtDate(doc.date)}</td>
                      <td>
                        {doc.spentItems.map((it, idx) => (
                          <div key={idx} style={{ fontSize: 13 }}>
                            <span>{it.name}</span>{" "}
                            <strong
                              style={{ color: "var(--adm-rust, #b83a24)" }}
                            >
                              −{fmtNum(it.quantity)} шт.
                            </strong>
                            {it.unitCost != null && (
                              <span
                                className="admin-muted"
                                style={{ fontSize: 11.5, marginLeft: 5 }}
                              >
                                ({fmtMoney(it.unitCost)} ₽/шт.
                                {it.sourceReceiptNumber
                                  ? `, ПО-${it.sourceReceiptNumber}`
                                  : ""}
                                )
                              </span>
                            )}
                          </div>
                        ))}
                      </td>
                      <td
                        style={{
                          width: 24,
                          textAlign: "center",
                          color: "var(--adm-muted)",
                        }}
                      >
                        <ArrowRight size={14} />
                      </td>
                      <td>
                        {doc.producedItems.map((it, idx) => (
                          <div key={idx} style={{ fontSize: 13 }}>
                            <span>{it.name}</span>{" "}
                            <strong
                              style={{ color: "var(--adm-pine, #2c5e4f)" }}
                            >
                              +{fmtNum(it.quantity)} шт.
                            </strong>
                            {it.unitCost != null && (
                              <span
                                className="admin-muted"
                                style={{ fontSize: 11.5, marginLeft: 5 }}
                              >
                                ({fmtMoney(it.unitCost)} ₽/шт.
                                {it.isManualPrice ? " · вручн." : " · +2 ₽"})
                              </span>
                            )}
                          </div>
                        ))}
                        {doc.comment && (
                          <div
                            style={{
                              fontSize: 11.5,
                              color: "var(--adm-muted, #666)",
                              marginTop: 2,
                            }}
                          >
                            💬 {doc.comment}
                          </div>
                        )}
                      </td>
                      <td style={{ textAlign: "right" }}>
                        {outSum > 0 ? `${fmtMoney(outSum)} ₽` : "—"}
                        {doc.totalCost > 0 && doc.totalCost !== outSum && (
                          <div
                            style={{
                              fontSize: 11,
                              color: "var(--adm-muted, #666)",
                            }}
                          >
                            сырьё: {fmtMoney(doc.totalCost)} ₽
                          </div>
                        )}
                      </td>
                      <td>
                        {isCancelled ? (
                          <span className="admin-badge admin-badge--muted">
                            Отменена
                          </span>
                        ) : (
                          <span className="admin-badge admin-badge--green">
                            Проведена
                          </span>
                        )}
                      </td>
                      <td style={{ textAlign: "right" }}>
                        <div
                          style={{
                            display: "inline-flex",
                            gap: 4,
                            alignItems: "center",
                          }}
                        >
                          <button
                            type="button"
                            className="admin-btn admin-btn--ghost admin-btn--sm"
                            onClick={() => handleRepeat(doc)}
                            disabled={busyId === doc.id}
                            title="Повторить с теми же позициями и количеством"
                          >
                            <Copy size={13} />
                            Повторить
                          </button>
                          {!isCancelled && (
                            <button
                              type="button"
                              className="admin-btn admin-btn--ghost admin-btn--sm"
                              onClick={() => handleCancelAssembly(doc)}
                              disabled={busyId === doc.id}
                              title="Отменить проведение (сторно остатков и ПО)"
                            >
                              {busyId === doc.id ? (
                                <Loader2 size={13} className="spin" />
                              ) : (
                                <RotateCcw size={13} />
                              )}
                              Отменить
                            </button>
                          )}
                          <button
                            type="button"
                            className="admin-btn admin-btn--ghost admin-btn--sm"
                            onClick={() => handleDeleteAssembly(doc)}
                            disabled={busyId === doc.id}
                            title="Удалить документ"
                          >
                            <Trash2 size={13} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
