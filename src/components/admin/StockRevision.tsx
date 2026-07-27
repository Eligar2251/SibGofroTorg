// src/components/admin/StockRevision.tsx
// Ревизия склада: выбор товаров → пустой бланк на печать → заполнение
// в электронном виде → печать заполненного акта → применение остатков.
"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ClipboardCheck,
  Printer,
  Search,
  X,
  Loader2,
  Check,
  RotateCcw,
  Save,
  AlertTriangle,
} from "lucide-react";
import { ModalPortal } from "@/components/admin/ModalPortal";
import {
  StockRevisionSheet,
  type RevisionSheetRow,
} from "@/components/admin/StockRevisionSheet";
import type { WarehouseStockRow } from "@/lib/warehouse-shared";

/** Черновик ревизии хранится локально: закрыл вкладку — данные не потерялись. */
const DRAFT_KEY = "sgt:stock-revision-draft:v1";

interface RevisionDraft {
  selectedIds: string[];
  actual: Record<string, string>;
  note: string;
  responsible: string;
  savedAt: number;
}

function loadDraft(): RevisionDraft | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(DRAFT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as RevisionDraft;
    if (!Array.isArray(parsed.selectedIds)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function StockRevision({ stock }: { stock: WarehouseStockRow[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  // step: pick — выбор товаров, fill — электронное заполнение
  const [step, setStep] = useState<"pick" | "fill">("pick");
  const [query, setQuery] = useState("");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [actual, setActual] = useState<Record<string, string>>({});
  const [note, setNote] = useState("");
  const [responsible, setResponsible] = useState("");
  const [printMode, setPrintMode] = useState<"blank" | "filled" | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [savedOk, setSavedOk] = useState(0);
  const [hasDraft, setHasDraft] = useState(false);

  // Подхватываем сохранённый черновик при первом рендере
  useEffect(() => {
    const draft = loadDraft();
    if (draft && draft.selectedIds.length > 0) setHasDraft(true);
  }, []);

  // Автосохранение черновика
  useEffect(() => {
    if (!open || selectedIds.size === 0) return;
    const draft: RevisionDraft = {
      selectedIds: [...selectedIds],
      actual,
      note,
      responsible,
      savedAt: Date.now(),
    };
    try {
      window.localStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
    } catch {
      /* приватный режим — просто не сохраняем */
    }
  }, [open, selectedIds, actual, note, responsible]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return stock;
    return stock.filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        (p.sku || "").toLowerCase().includes(q)
    );
  }, [stock, query]);

  const selectedRows = useMemo(
    () => stock.filter((p) => selectedIds.has(p.id)),
    [stock, selectedIds]
  );

  const sheetRows: RevisionSheetRow[] = useMemo(
    () =>
      selectedRows.map((p) => {
        const raw = actual[p.id];
        const parsed = raw != null && raw !== "" ? Math.max(0, Math.floor(Number(raw) || 0)) : null;
        return {
          id: p.id,
          name: p.name,
          sku: p.sku,
          stockQty: p.stockQty,
          actualQty: parsed,
        };
      }),
    [selectedRows, actual]
  );

  const changedRows = useMemo(
    () => sheetRows.filter((r) => r.actualQty != null && r.actualQty !== r.stockQty),
    [sheetRows]
  );
  const filledCount = sheetRows.filter((r) => r.actualQty != null).length;

  function toggle(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function selectAllFiltered() {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      for (const p of filtered) next.add(p.id);
      return next;
    });
  }

  function clearSelection() {
    setSelectedIds(new Set());
    setActual({});
  }

  function restoreDraft() {
    const draft = loadDraft();
    if (!draft) return;
    setSelectedIds(new Set(draft.selectedIds));
    setActual(draft.actual || {});
    setNote(draft.note || "");
    setResponsible(draft.responsible || "");
    setHasDraft(false);
    setStep(Object.keys(draft.actual || {}).length > 0 ? "fill" : "pick");
  }

  function discardDraft() {
    try {
      window.localStorage.removeItem(DRAFT_KEY);
    } catch {
      /* noop */
    }
    setHasDraft(false);
  }

  /** Проставить «факт = учёт» для незаполненных строк — быстрый ввод. */
  function fillRestAsAccounted() {
    setActual((prev) => {
      const next = { ...prev };
      for (const row of selectedRows) {
        if (next[row.id] == null || next[row.id] === "") {
          next[row.id] = String(row.stockQty);
        }
      }
      return next;
    });
  }

  /** Применить факт к остаткам склада. */
  async function applyRevision() {
    if (changedRows.length === 0) {
      setError("Нет расхождений — применять нечего");
      return;
    }
    if (
      !confirm(
        `Применить ревизию? Остатки изменятся у ${changedRows.length} поз. Это действие меняет склад.`
      )
    ) {
      return;
    }
    setSaving(true);
    setError("");
    try {
      const res = await fetch("/api/admin/warehouse/revision", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          note: note.trim() || null,
          responsible: responsible.trim() || null,
          items: changedRows.map((r) => ({
            productId: r.id,
            name: r.name,
            accountedQty: r.stockQty,
            actualQty: r.actualQty,
          })),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Не удалось применить ревизию");
      setSavedOk(changedRows.length);
      discardDraft();
      setActual({});
      setSelectedIds(new Set());
      setStep("pick");
      router.refresh();
      window.setTimeout(() => setSavedOk(0), 4000);
      setOpen(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка сети");
    }
    setSaving(false);
  }

  return (
    <>
      <button
        type="button"
        className="admin-btn admin-btn--outline"
        onClick={() => setOpen(true)}
        title="Ревизия склада: бланк для пересчёта и сверка остатков"
      >
        <ClipboardCheck size={15} />
        Ревизия склада
      </button>

      {savedOk > 0 && (
        <span className="admin-badge admin-badge--green" style={{ marginLeft: 8 }}>
          <Check size={11} /> Ревизия применена: {savedOk} поз.
        </span>
      )}

      {printMode && (
        <StockRevisionSheet
          rows={sheetRows}
          filled={printMode === "filled"}
          note={note.trim() || null}
          responsible={responsible.trim() || null}
          onDone={() => setPrintMode(null)}
        />
      )}

      {open && (
        <ModalPortal>
          <div
            className="admin-modal-overlay"
            data-admin="true"
            onClick={() => setOpen(false)}
          >
            <div
              className="admin-modal wh-modal rev-modal"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="admin-modal__head">
                <h3 className="admin-modal__title">
                  {step === "pick" ? "Ревизия: выбор товаров" : "Ревизия: заполнение"}
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

              {hasDraft && (
                <div className="rev-draft-bar">
                  <span>Найден незаконченный черновик ревизии.</span>
                  <button
                    type="button"
                    className="admin-btn admin-btn--ghost admin-btn--sm"
                    onClick={restoreDraft}
                  >
                    <RotateCcw size={12} /> Продолжить
                  </button>
                  <button
                    type="button"
                    className="admin-btn admin-btn--ghost admin-btn--sm"
                    onClick={discardDraft}
                  >
                    Удалить
                  </button>
                </div>
              )}

              {/* ── Шаг 1: выбор товаров ── */}
              {step === "pick" && (
                <>
                  <p className="admin-modal__desc">
                    Отметьте товары для пересчёта. Затем распечатайте пустой бланк
                    и впишите фактические остатки ручкой — или сразу заполните
                    форму на этом экране.
                  </p>

                  <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
                    <div style={{ position: "relative", flex: 1 }}>
                      <Search
                        size={15}
                        style={{
                          position: "absolute",
                          left: 10,
                          top: "50%",
                          transform: "translateY(-50%)",
                          color: "var(--adm-sand)",
                        }}
                      />
                      <input
                        className="admin-input"
                        style={{ paddingLeft: 32 }}
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                        placeholder="Поиск по названию или артикулу..."
                      />
                    </div>
                    <button
                      type="button"
                      className="admin-btn admin-btn--ghost admin-btn--sm"
                      onClick={selectAllFiltered}
                      title="Выбрать все найденные"
                    >
                      Выбрать все
                    </button>
                    {selectedIds.size > 0 && (
                      <button
                        type="button"
                        className="admin-btn admin-btn--ghost admin-btn--sm"
                        onClick={clearSelection}
                      >
                        Снять
                      </button>
                    )}
                  </div>

                  <div className="rev-pick-list">
                    {filtered.length === 0 ? (
                      <div className="admin-empty" style={{ padding: 20 }}>
                        Ничего не найдено
                      </div>
                    ) : (
                      filtered.map((p) => (
                        <label key={p.id} className="rev-pick-row">
                          <input
                            type="checkbox"
                            checked={selectedIds.has(p.id)}
                            onChange={() => toggle(p.id)}
                          />
                          <span className="rev-pick-row__name">{p.name}</span>
                          <span className="rev-pick-row__sku">{p.sku || "—"}</span>
                          <span className="rev-pick-row__qty">
                            {p.stockQty.toLocaleString("ru-RU")} шт.
                          </span>
                        </label>
                      ))
                    )}
                  </div>
                </>
              )}

              {/* ── Шаг 2: электронное заполнение ── */}
              {step === "fill" && (
                <>
                  <p className="admin-modal__desc">
                    Впишите фактические остатки. Пустое поле = позиция не
                    пересчитана и останется без изменений.
                  </p>

                  <div className="wh-form-grid" style={{ marginBottom: 10 }}>
                    <div className="admin-field">
                      <label className="admin-label">Ответственный</label>
                      <input
                        className="admin-input"
                        value={responsible}
                        onChange={(e) => setResponsible(e.target.value)}
                        placeholder="Кто считал"
                      />
                    </div>
                    <div className="admin-field">
                      <label className="admin-label">Примечание</label>
                      <input
                        className="admin-input"
                        value={note}
                        onChange={(e) => setNote(e.target.value)}
                        placeholder="Напр. плановая ревизия"
                      />
                    </div>
                  </div>

                  <div className="rev-fill-head">
                    <span>Товар</span>
                    <span style={{ textAlign: "right" }}>Учёт</span>
                    <span style={{ textAlign: "right" }}>Факт</span>
                    <span style={{ textAlign: "right" }}>Разница</span>
                  </div>
                  <div className="rev-fill-list">
                    {selectedRows.map((p) => {
                      const raw = actual[p.id] ?? "";
                      const parsed =
                        raw !== "" ? Math.max(0, Math.floor(Number(raw) || 0)) : null;
                      const diff = parsed != null ? parsed - p.stockQty : null;
                      return (
                        <div key={p.id} className="rev-fill-row">
                          <span className="rev-fill-row__name">
                            {p.name}
                            {p.sku && (
                              <span className="rev-fill-row__sku"> · {p.sku}</span>
                            )}
                          </span>
                          <span className="rev-fill-row__acc">
                            {p.stockQty.toLocaleString("ru-RU")}
                          </span>
                          <input
                            type="number"
                            min={0}
                            step={1}
                            inputMode="numeric"
                            className="admin-input rev-fill-row__input"
                            value={raw}
                            placeholder="—"
                            onChange={(e) =>
                              setActual((prev) => ({ ...prev, [p.id]: e.target.value }))
                            }
                          />
                          <span
                            className={`rev-fill-row__diff${
                              diff != null && diff !== 0 ? " rev-fill-row__diff--warn" : ""
                            }`}
                          >
                            {diff == null ? "—" : diff === 0 ? "0" : diff > 0 ? `+${diff}` : diff}
                          </span>
                        </div>
                      );
                    })}
                  </div>

                  <div className="rev-fill-summary">
                    Заполнено: <b>{filledCount}</b> из {selectedRows.length} ·
                    Расхождений: <b>{changedRows.length}</b>
                    <button
                      type="button"
                      className="admin-btn admin-btn--ghost admin-btn--sm"
                      onClick={fillRestAsAccounted}
                      style={{ marginLeft: "auto" }}
                      title="Остальным поставить факт = учёт"
                    >
                      Остальные без изменений
                    </button>
                  </div>
                </>
              )}

              {error && (
                <div className="admin-error" style={{ marginTop: 10 }}>
                  <AlertTriangle size={13} /> {error}
                </div>
              )}

              <div className="admin-modal__actions rev-modal__actions">
                <span className="rev-modal__count">
                  Выбрано: <b>{selectedIds.size}</b>
                </span>

                {step === "pick" ? (
                  <>
                    <button
                      type="button"
                      className="admin-btn admin-btn--outline"
                      disabled={selectedIds.size === 0}
                      onClick={() => setPrintMode("blank")}
                      title="Печать пустого бланка для пересчёта ручкой"
                    >
                      <Printer size={14} /> Печать бланка
                    </button>
                    <button
                      type="button"
                      className="admin-btn admin-btn--primary"
                      disabled={selectedIds.size === 0}
                      onClick={() => setStep("fill")}
                    >
                      Заполнить форму →
                    </button>
                  </>
                ) : (
                  <>
                    <button
                      type="button"
                      className="admin-btn admin-btn--ghost"
                      onClick={() => setStep("pick")}
                    >
                      ← Назад к выбору
                    </button>
                    <button
                      type="button"
                      className="admin-btn admin-btn--outline"
                      onClick={() => setPrintMode("filled")}
                      disabled={filledCount === 0}
                      title="Печать заполненного акта ревизии"
                    >
                      <Printer size={14} /> Печать акта
                    </button>
                    <button
                      type="button"
                      className="admin-btn admin-btn--primary"
                      onClick={applyRevision}
                      disabled={saving || changedRows.length === 0}
                      title="Записать фактические остатки на склад"
                    >
                      {saving ? (
                        <Loader2 size={14} className="animate-spin" />
                      ) : (
                        <Save size={14} />
                      )}
                      Применить ({changedRows.length})
                    </button>
                  </>
                )}
              </div>
            </div>
          </div>
        </ModalPortal>
      )}
    </>
  );
}
