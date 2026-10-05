// =========================================================
// FILE: src/components/admin/rent/RentBuildingScheme.tsx
// Схема здания: корпуса, этажи и клеточные планировки.
//   • редактор клеток — в RentFloorPlanner (стены, двери, окна,
//     помещения, автонарезка, ластик, отмена/повтор);
//   • сохранение черновика и публикация схемы корпуса;
//   • после публикации схема открывается в чистом виде — без линий
//     сетки, только стены, проёмы и заливки помещений;
//   • статистика этажа: занято/свободно, площади, долги.
// =========================================================

"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  Building2,
  CheckCircle2,
  Eye,
  Layers,
  Loader2,
  MapPin,
  Pencil,
  Plus,
  Rocket,
  Ruler,
  Save,
  Settings2,
  Square,
  Trash2,
  Undo2,
  Users,
  X,
} from "lucide-react";
import { ModalPortal } from "@/components/admin/ModalPortal";
import { useEscapeClose } from "@/hooks/use-escape-close";
import {
  PLAN_DEFAULT_CELL_SIZE,
  PLAN_DEFAULT_COLS,
  PLAN_DEFAULT_ROWS,
  PLAN_MAX_COLS,
  PLAN_MIN_COLS,
  createFloorPlan,
  normalizeCells,
  roomArea,
  type RentBuilding,
  type RentFloorPlan,
} from "@/lib/rent-building";
import { computeTenantState, rentFmt, type RentInvoice, type RentOrg, type RentTenant } from "@/lib/rent-shared";
import { RentFloorPlanner } from "./RentFloorPlanner";

type Props = {
  initialBuildings: RentBuilding[];
  initialPlans: RentFloorPlan[];
  tenants: RentTenant[];
  invoices: RentInvoice[];
  orgs: RentOrg[];
  readOnly?: boolean;
};

type Mode = "edit" | "view";

function clonePlans(plans: RentFloorPlan[]): RentFloorPlan[] {
  return plans.map((p) => ({
    ...p,
    walls: p.walls.map((w) => ({ ...w })),
    openings: p.openings.map((o) => ({ ...o })),
    rooms: p.rooms.map((r) => ({ ...r, cells: [...r.cells] })),
  }));
}

export function RentBuildingScheme({
  initialBuildings,
  initialPlans,
  tenants,
  invoices,
  orgs,
  readOnly,
}: Props) {
  void orgs;
  const router = useRouter();
  const [buildings, setBuildings] = useState<RentBuilding[]>(
    initialBuildings.length ? initialBuildings : [{ id: "main", name: "Главный корпус", address: null, floors: 3 }]
  );
  const [plans, setPlans] = useState<RentFloorPlan[]>(() => clonePlans(initialPlans));
  const [activeBuildingId, setActiveBuildingId] = useState(initialBuildings[0]?.id || "main");
  const [activeFloor, setActiveFloor] = useState(1);
  const [mode, setMode] = useState<Mode>(readOnly ? "view" : "edit");
  const [selectedRoomId, setSelectedRoomId] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [buildingModal, setBuildingModal] = useState<RentBuilding | null>(null);
  const [newBuildingMode, setNewBuildingMode] = useState(false);
  const [gridModal, setGridModal] = useState<RentFloorPlan | null>(null);
  const plansRef = useRef(plans);

  const today = useMemo(() => new Date().toISOString().slice(0, 10), []);

  const activeBuilding = useMemo(
    () => buildings.find((b) => b.id === activeBuildingId) || buildings[0],
    [buildings, activeBuildingId]
  );

  useEffect(() => {
    plansRef.current = plans;
  }, [plans]);

  useEffect(() => {
    if (activeBuilding && activeFloor > activeBuilding.floors) setActiveFloor(1);
  }, [activeBuilding, activeFloor]);

  // Предупреждение при закрытии страницы с несохранённой схемой.
  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [dirty]);

  /** Планировка активного этажа (создаётся «на лету», если её ещё нет). */
  const activePlan = useMemo(() => {
    const found = plans.find((p) => p.buildingId === activeBuildingId && p.floor === activeFloor);
    if (found) return found;
    const base = plans.find((p) => p.buildingId === activeBuildingId);
    return createFloorPlan(activeBuildingId, activeFloor, {
      cols: base?.cols ?? PLAN_DEFAULT_COLS,
      rows: base?.rows ?? PLAN_DEFAULT_ROWS,
      cellSize: base?.cellSize ?? PLAN_DEFAULT_CELL_SIZE,
    });
  }, [plans, activeBuildingId, activeFloor]);

  const upsertPlan = (next: RentFloorPlan, markDirty = true) => {
    setPlans((prev) => {
      const exists = prev.some((p) => p.buildingId === next.buildingId && p.floor === next.floor);
      if (!exists) return [...prev, next];
      return prev.map((p) =>
        p.buildingId === next.buildingId && p.floor === next.floor ? next : p
      );
    });
    if (markDirty) setDirty(true);
  };

  const tenantById = useMemo(() => new Map(tenants.map((t) => [t.id, t])), [tenants]);

  const floorStats = useMemo(() => {
    const rooms = activePlan.rooms;
    const occupied = rooms.filter((r) => r.tenantId);
    const areaTotal = rooms.reduce((s, r) => s + roomArea(activePlan, r), 0);
    const areaOccupied = occupied.reduce((s, r) => s + roomArea(activePlan, r), 0);
    let debt = 0;
    let overdue = 0;
    let rent = 0;
    for (const room of occupied) {
      const tenant = tenantById.get(room.tenantId as string);
      if (!tenant) continue;
      const st = computeTenantState(tenant, invoices, today);
      debt += st.debt;
      overdue += st.overdue;
      rent += tenant.monthlyRent;
    }
    return {
      total: rooms.length,
      occupied: occupied.length,
      vacant: rooms.length - occupied.length,
      areaTotal: Math.round(areaTotal * 10) / 10,
      areaOccupied: Math.round(areaOccupied * 10) / 10,
      debt: Math.round(debt * 10) / 10,
      overdue: Math.round(overdue * 10) / 10,
      rent: Math.round(rent * 10) / 10,
      areaFloor: Math.round(activePlan.cols * activePlan.cellSize * activePlan.rows * activePlan.cellSize * 10) / 10,
    };
  }, [activePlan, tenantById, invoices, today]);

  const buildingPlans = useMemo(
    () => plans.filter((p) => p.buildingId === activeBuildingId),
    [plans, activeBuildingId]
  );
  const publishedCount = buildingPlans.filter((p) => p.published).length;
  const isPublished = Boolean(activePlan.published);

  /* ───────────────────── сохранение / публикация ───────────────────── */

  async function save(nextPlans?: RentFloorPlan[], silent = false) {
    const payloadPlans = nextPlans || plansRef.current;
    setSaving(true);
    setError("");
    try {
      const res = await fetch("/api/admin/rent/building", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ buildings, plans: payloadPlans }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Не удалось сохранить схему");
      if (Array.isArray(data.plans)) setPlans(clonePlans(data.plans));
      if (Array.isArray(data.buildings) && data.buildings.length) setBuildings(data.buildings);
      setDirty(false);
      if (!silent) {
        setSuccess("Схема сохранена");
        setTimeout(() => setSuccess(""), 2200);
      }
      router.refresh();
      return true;
    } catch (e: any) {
      setError(e.message || "Ошибка сохранения");
      return false;
    } finally {
      setSaving(false);
    }
  }

  async function publish() {
    if (readOnly || !activeBuilding) return;
    const stamp = new Date().toISOString();
    const next = clonePlans(plansRef.current);
    for (let floor = 1; floor <= activeBuilding.floors; floor += 1) {
      let plan = next.find((p) => p.buildingId === activeBuildingId && p.floor === floor);
      if (!plan) {
        plan = createFloorPlan(activeBuildingId, floor, {
          cols: activePlan.cols,
          rows: activePlan.rows,
          cellSize: activePlan.cellSize,
        });
        next.push(plan);
      }
      plan.published = true;
      plan.publishedAt = stamp;
      plan.updatedAt = stamp;
    }
    setPlans(next);
    setDirty(true);
    const ok = await save(next, true);
    if (ok) {
      setSuccess(`«${activeBuilding.name}» опубликован: схема открывается в чистом виде, без линий сетки`);
      setTimeout(() => setSuccess(""), 4000);
    }
  }

  async function unpublish() {
    if (readOnly) return;
    const next = clonePlans(plansRef.current).map((p) =>
      p.buildingId === activeBuildingId ? { ...p, published: false, publishedAt: null } : p
    );
    setPlans(next);
    setDirty(true);
    const ok = await save(next, true);
    if (ok) {
      setSuccess("Публикация снята — схема доступна только в редакторе");
      setTimeout(() => setSuccess(""), 3000);
    }
  }

  /* ───────────────────────── корпуса ───────────────────────── */

  function addBuilding() {
    setNewBuildingMode(true);
    setBuildingModal({ id: `b-${Date.now()}`, name: "Новый корпус", address: null, floors: 3 });
  }

  function editBuilding(b: RentBuilding) {
    setNewBuildingMode(false);
    setBuildingModal({ ...b });
  }

  function saveBuildingModal() {
    if (!buildingModal) return;
    const name = buildingModal.name.trim();
    if (!name) {
      setError("Укажите название корпуса");
      return;
    }
    const floors = Math.max(1, Math.min(20, Math.round(buildingModal.floors)));
    if (newBuildingMode) {
      const nextBuildings = [...buildings, { ...buildingModal, name, floors }];
      setBuildings(nextBuildings);
      setActiveBuildingId(buildingModal.id);
      setActiveFloor(1);
      setDirty(true);
      void saveWithBuildings(nextBuildings);
    } else {
      const nextBuildings = buildings.map((b) =>
        b.id === buildingModal.id ? { ...buildingModal, name, floors } : b
      );
      setBuildings(nextBuildings);
      setDirty(true);
      void saveWithBuildings(nextBuildings);
    }
    setBuildingModal(null);
  }

  async function saveWithBuildings(nextBuildings: RentBuilding[]) {
    setSaving(true);
    setError("");
    try {
      const res = await fetch("/api/admin/rent/building", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ buildings: nextBuildings, plans: plansRef.current }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Не удалось сохранить корпус");
      if (Array.isArray(data.plans)) setPlans(clonePlans(data.plans));
      setDirty(false);
      router.refresh();
    } catch (e: any) {
      setError(e.message || "Ошибка сохранения");
    } finally {
      setSaving(false);
    }
  }

  function deleteBuilding(id: string) {
    if (buildings.length <= 1) {
      setError("Нельзя удалить единственный корпус");
      return;
    }
    if (!confirm("Удалить корпус вместе со всеми этажами и планировками?")) return;
    const nextBuildings = buildings.filter((b) => b.id !== id);
    const nextPlans = plansRef.current.filter((p) => p.buildingId !== id);
    setBuildings(nextBuildings);
    setPlans(nextPlans);
    setActiveBuildingId(nextBuildings[0].id);
    setActiveFloor(1);
    setSelectedRoomId(null);
    setDirty(true);
    setSaving(true);
    fetch("/api/admin/rent/building", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ buildings: nextBuildings, plans: nextPlans }),
    })
      .then((res) => res.json().catch(() => ({})))
      .then((data) => {
        if (Array.isArray(data.plans)) setPlans(clonePlans(data.plans));
        setDirty(false);
        router.refresh();
      })
      .catch((e: any) => setError(e?.message || "Ошибка сохранения"))
      .finally(() => setSaving(false));
  }

  /* ───────────────────────── настройки этажа ───────────────────────── */

  function applyGridSettings() {
    if (!gridModal) return;
    const cols = Math.max(PLAN_MIN_COLS, Math.min(PLAN_MAX_COLS, Math.round(gridModal.cols)));
    const rows = Math.max(PLAN_MIN_COLS, Math.min(PLAN_MAX_COLS, Math.round(gridModal.rows)));
    const cellSize = Math.max(0.1, Math.min(5, Number(gridModal.cellSize) || PLAN_DEFAULT_CELL_SIZE));
    const next: RentFloorPlan = {
      ...gridModal,
      cols,
      rows,
      cellSize,
      walls: gridModal.walls.filter((w) =>
        w.o === "h" ? w.x < cols && w.y <= rows : w.y < rows && w.x <= cols
      ),
      openings: gridModal.openings.filter((o) =>
        o.o === "h" ? o.x < cols && o.y <= rows : o.y < rows && o.x <= cols
      ),
      rooms: gridModal.rooms
        .map((r) => ({ ...r, cells: normalizeCells(r.cells, cols, rows) }))
        .filter((r) => r.cells.length > 0),
    };
    upsertPlan(next);
    setGridModal(null);
  }

  function toggleMode(next: Mode) {
    if (readOnly && next === "edit") return;
    setSelectedRoomId(null);
    setMode(next);
  }

  // Правки этажей живут в состоянии до нажатия «Сохранить», поэтому
  // переключение этажа/корпуса их не теряет — только предупреждаем при уходе со страницы.
  function switchFloor(floor: number) {
    setActiveFloor(floor);
    setSelectedRoomId(null);
  }

  function switchBuilding(id: string) {
    setActiveBuildingId(id);
    setActiveFloor(1);
    setSelectedRoomId(null);
  }

  /* ───────────────────────────── UI ───────────────────────────── */

  return (
    <div className="rent-scheme">
      {/* Верхняя панель */}
      <div className="rs-top">
        <div className="rs-top__row">
          <div className="rs-top__building">
            <Building2 size={15} />
            <select
              className="admin-select rs-top__select"
              value={activeBuildingId}
              onChange={(e) => switchBuilding(e.target.value)}
            >
              {buildings.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name} · {b.floors} эт.
                </option>
              ))}
            </select>
            {!readOnly && (
              <>
                <button className="admin-btn admin-btn--ghost admin-btn--sm" onClick={addBuilding} title="Добавить корпус">
                  <Plus size={13} /> Корпус
                </button>
                <button
                  className="admin-btn admin-btn--ghost admin-btn--sm"
                  onClick={() => activeBuilding && editBuilding(activeBuilding)}
                  title="Настройки корпуса"
                >
                  <Settings2 size={13} />
                </button>
                {buildings.length > 1 && activeBuilding && (
                  <button
                    className="admin-btn admin-btn--ghost admin-btn--sm"
                    onClick={() => deleteBuilding(activeBuilding.id)}
                    title="Удалить корпус"
                  >
                    <Trash2 size={13} />
                  </button>
                )}
              </>
            )}
          </div>

          <div className="rs-top__mode">
            <button
              type="button"
              className={`admin-filter${mode === "edit" ? " admin-filter--active" : ""}`}
              onClick={() => toggleMode("edit")}
              disabled={readOnly}
              title={readOnly ? "Редактирование доступно администратору" : "Рисовать стены, двери и помещения"}
            >
              <Pencil size={13} /> Редактор
            </button>
            <button
              type="button"
              className={`admin-filter${mode === "view" ? " admin-filter--active" : ""}`}
              onClick={() => toggleMode("view")}
              title="Чистая схема без линий сетки — как её видят остальные"
            >
              <Eye size={13} /> Просмотр
            </button>
          </div>

          <div className="rs-top__actions">
            {!readOnly && (
              <>
                <button
                  className="admin-btn admin-btn--primary admin-btn--sm"
                  onClick={() => save()}
                  disabled={saving}
                >
                  {saving ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />}
                  {dirty ? "Сохранить" : "Сохранить"}
                </button>
                {isPublished ? (
                  <button className="admin-btn admin-btn--outline admin-btn--sm" onClick={unpublish} disabled={saving}>
                    <Undo2 size={13} /> Снять публикацию
                  </button>
                ) : (
                  <button className="admin-btn admin-btn--outline admin-btn--sm" onClick={publish} disabled={saving}>
                    <Rocket size={13} /> Опубликовать корпус
                  </button>
                )}
              </>
            )}
            <button
              className="admin-btn admin-btn--ghost admin-btn--sm"
              onClick={() => setGridModal({ ...activePlan })}
              disabled={readOnly}
              title="Размер сетки, масштаб клетки"
            >
              <Ruler size={13} /> Сетка
            </button>
          </div>
        </div>

        <div className="rs-top__row rs-top__row--floors">
          <div className="rs-floors">
            <Layers size={13} />
            {Array.from({ length: activeBuilding?.floors || 3 }, (_, i) => i + 1).map((floor) => {
              const plan = plans.find((p) => p.buildingId === activeBuildingId && p.floor === floor);
              return (
                <button
                  key={floor}
                  className={`rs-floor${activeFloor === floor ? " rs-floor--on" : ""}`}
                  onClick={() => switchFloor(floor)}
                >
                  {floor} этаж
                  {plan ? <span className="rs-floor__count">{plan.rooms.length || "—"}</span> : null}
                  {plan?.published ? <span className="rs-floor__dot rs-floor__dot--pub" title="опубликован" /> : null}
                </button>
              );
            })}
          </div>

          <div className="rs-badges">
            {dirty && <span className="rs-badge rs-badge--warn">не сохранено</span>}
            {isPublished ? (
              <span className="rs-badge rs-badge--ok">опубликован</span>
            ) : (
              <span className="rs-badge rs-badge--draft">черновик</span>
            )}
            <span className="rs-badge rs-badge--muted">
              корпус: {publishedCount} из {activeBuilding?.floors || 0} эт. опубликовано
            </span>
          </div>
        </div>
      </div>

      {error && (
        <div className="admin-error" style={{ display: "flex", gap: 6, alignItems: "center" }}>
          <AlertTriangle size={14} /> {error}
        </div>
      )}
      {success && (
        <div className="admin-success" style={{ display: "inline-flex", gap: 6 }}>
          <CheckCircle2 size={14} /> {success}
        </div>
      )}

      {mode === "view" && !isPublished && !readOnly && (
        <div className="rs-note">
          <Rocket size={14} />
          <span>
            Это черновик: схема видна в чистом виде (без линий сетки), но для остальных она
            останется черновиком, пока вы не нажмёте «Опубликовать корпус».
          </span>
        </div>
      )}

      {mode === "edit" && activePlan.walls.length === 0 && activePlan.rooms.length === 0 && (
        <div className="rs-note rs-note--hint">
          <Ruler size={14} />
          <span>
            Этаж пока пуст. Быстрый путь: «Контур этажа» → «Автонарезка на помещения» → проведите
            двери и окна по стенам. Или рисуйте вручную: инструмент «Стена» ведите по клеткам,
            «Помещение» — протяните прямоугольник.
          </span>
        </div>
      )}

      {/* Сам планировщик */}
      <RentFloorPlanner
        plan={activePlan}
        onChange={(next, options) => upsertPlan(next, options?.markDirty !== false)}
        readOnly={Boolean(readOnly)}
        mode={mode}
        tenants={tenants}
        invoices={invoices}
        today={today}
        selectedRoomId={selectedRoomId}
        onSelectRoom={setSelectedRoomId}
      />

      {/* Статистика этажа */}
      <div className="rs-stats">
        <div className="admin-stat">
          <div className="admin-stat__icon" style={{ background: "var(--adm-steel-pale)", color: "var(--adm-steel)" }}>
            <Square size={16} />
          </div>
          <div>
            <div className="admin-stat__label">Помещений на этаже</div>
            <div className="admin-stat__value">{floorStats.total}</div>
          </div>
        </div>
        <div className="admin-stat">
          <div className="admin-stat__icon" style={{ background: "var(--adm-pine-pale)", color: "var(--adm-pine)" }}>
            <Users size={16} />
          </div>
          <div>
            <div className="admin-stat__label">Занято / свободно</div>
            <div className="admin-stat__value">
              {floorStats.occupied} / {floorStats.vacant}
            </div>
          </div>
        </div>
        <div className="admin-stat">
          <div className="admin-stat__icon" style={{ background: "var(--adm-paper-warm)", color: "var(--adm-sand)" }}>
            <Ruler size={16} />
          </div>
          <div>
            <div className="admin-stat__label">Площадь занятых / этажа</div>
            <div className="admin-stat__value">
              {floorStats.areaOccupied} / {floorStats.areaTotal} м²
            </div>
          </div>
        </div>
        <div className="admin-stat">
          <div className="admin-stat__icon" style={{ background: "var(--adm-kraft-pale)", color: "var(--adm-kraft)" }}>
            <MapPin size={16} />
          </div>
          <div>
            <div className="admin-stat__label">Аренда в месяц по этажу</div>
            <div className="admin-stat__value">{rentFmt(floorStats.rent)} ₽</div>
          </div>
        </div>
        <div className="admin-stat">
          <div
            className="admin-stat__icon"
            style={{
              background: floorStats.overdue > 0 ? "var(--adm-rust-pale)" : "var(--adm-paper-warm)",
              color: floorStats.overdue > 0 ? "var(--adm-rust)" : "var(--adm-sand)",
            }}
          >
            <AlertTriangle size={16} />
          </div>
          <div>
            <div className="admin-stat__label">Долг / просрочка</div>
            <div
              className="admin-stat__value"
              style={{ color: floorStats.overdue > 0 ? "var(--adm-rust)" : undefined }}
            >
              {rentFmt(floorStats.debt)} / {rentFmt(floorStats.overdue)} ₽
            </div>
          </div>
        </div>
      </div>

      <div className="rs-legend">
        <span className="rs-legend__title">Легенда</span>
        <span className="rs-legend__item">
          <i style={{ background: "#eef2f7", borderColor: "#c3ccd8" }} /> свободно
        </span>
        <span className="rs-legend__item">
          <i style={{ background: "#e8f4ec", borderColor: "#a3c9af" }} /> занято, без долга
        </span>
        <span className="rs-legend__item">
          <i style={{ background: "#fdf3dc", borderColor: "#e2c98a" }} /> есть долг
        </span>
        <span className="rs-legend__item">
          <i style={{ background: "#fdeceb", borderColor: "#e9b4a8" }} /> просрочка
        </span>
        <span className="rs-legend__item rs-legend__item--wall">
          <i className="rs-legend__wall" /> стены
        </span>
        <span className="rs-legend__item rs-legend__item--door">
          <i className="rs-legend__door" /> двери
        </span>
        <span className="rs-legend__item rs-legend__item--window">
          <i className="rs-legend__window" /> окна
        </span>
      </div>

      {/* Модалка настроек корпуса */}
      {buildingModal && (
        <ModalPortal>
          <div className="admin-modal-overlay" data-admin="true" onClick={() => setBuildingModal(null)}>
            <div className="admin-modal" style={{ maxWidth: 460 }} onClick={(e) => e.stopPropagation()}>
              <div className="admin-modal__head">
                <h3 className="admin-modal__title">
                  {newBuildingMode ? "Новый корпус" : "Настройка корпуса"}
                </h3>
                <button className="admin-modal__close" onClick={() => setBuildingModal(null)}>
                  <X size={16} />
                </button>
              </div>
              <div className="admin-form" style={{ padding: "0 20px" }}>
                <div className="admin-field">
                  <label className="admin-label">Название *</label>
                  <input
                    className="admin-input"
                    value={buildingModal.name}
                    onChange={(e) => setBuildingModal({ ...buildingModal, name: e.target.value })}
                    placeholder="Главный корпус"
                  />
                </div>
                <div className="admin-field">
                  <label className="admin-label">Адрес</label>
                  <input
                    className="admin-input"
                    value={buildingModal.address || ""}
                    onChange={(e) => setBuildingModal({ ...buildingModal, address: e.target.value })}
                    placeholder="ул. Примерная, 1"
                  />
                </div>
                <div className="admin-field">
                  <label className="admin-label">Этажей</label>
                  <input
                    type="number"
                    min={1}
                    max={20}
                    className="admin-input"
                    value={buildingModal.floors}
                    onChange={(e) =>
                      setBuildingModal({ ...buildingModal, floors: Number(e.target.value) })
                    }
                  />
                </div>
              </div>
              <div className="admin-modal__actions">
                <button className="admin-btn admin-btn--ghost" onClick={() => setBuildingModal(null)}>
                  Отмена
                </button>
                <button className="admin-btn admin-btn--primary" onClick={saveBuildingModal}>
                  <Save size={14} /> Сохранить
                </button>
              </div>
            </div>
          </div>
        </ModalPortal>
      )}

      {/* Модалка настроек сетки */}
      {gridModal && (
        <GridSettingsModal
          plan={gridModal}
          onChange={setGridModal}
          onApply={applyGridSettings}
          onClose={() => setGridModal(null)}
        />
      )}
    </div>
  );
}

/* ─────────────────── модалка настроек сетки этажа ─────────────────── */

function GridSettingsModal({
  plan,
  onChange,
  onApply,
  onClose,
}: {
  plan: RentFloorPlan;
  onChange: (plan: RentFloorPlan) => void;
  onApply: () => void;
  onClose: () => void;
}) {
  useEscapeClose(onClose);
  const presets = [
    { label: "Компактно 24×16", cols: 24, rows: 16, cellSize: 0.5 },
    { label: "Стандарт 40×24", cols: 40, rows: 24, cellSize: 0.5 },
    { label: "Подробно 60×36", cols: 60, rows: 36, cellSize: 0.25 },
  ];
  return (
    <ModalPortal>
      <div className="admin-modal-overlay" data-admin="true" onClick={onClose}>
        <div className="admin-modal" style={{ maxWidth: 520 }} onClick={(e) => e.stopPropagation()}>
          <div className="admin-modal__head">
            <h3 className="admin-modal__title">Сетка этажа</h3>
            <button className="admin-modal__close" onClick={onClose}>
              <X size={16} />
            </button>
          </div>
          <div className="admin-form" style={{ padding: "0 20px" }}>
            <div className="rfp__presets">
              {presets.map((p) => (
                <button
                  key={p.label}
                  type="button"
                  className="admin-btn admin-btn--ghost admin-btn--sm"
                  onClick={() => onChange({ ...plan, cols: p.cols, rows: p.rows, cellSize: p.cellSize })}
                >
                  {p.label}
                </button>
              ))}
            </div>
            <div className="admin-grid-2">
              <div className="admin-field">
                <label className="admin-label">Клеток по ширине</label>
                <input
                  type="number"
                  min={PLAN_MIN_COLS}
                  max={PLAN_MAX_COLS}
                  className="admin-input"
                  value={plan.cols}
                  onChange={(e) => onChange({ ...plan, cols: Number(e.target.value) })}
                />
              </div>
              <div className="admin-field">
                <label className="admin-label">Клеток по высоте</label>
                <input
                  type="number"
                  min={PLAN_MIN_COLS}
                  max={PLAN_MAX_COLS}
                  className="admin-input"
                  value={plan.rows}
                  onChange={(e) => onChange({ ...plan, rows: Number(e.target.value) })}
                />
              </div>
            </div>
            <div className="admin-field">
              <label className="admin-label">Размер клетки, м</label>
              <select
                className="admin-select"
                value={String(plan.cellSize)}
                onChange={(e) => onChange({ ...plan, cellSize: Number(e.target.value) })}
              >
                {[0.1, 0.25, 0.5, 1, 2].map((v) => (
                  <option key={v} value={v}>
                    {v} м
                  </option>
                ))}
              </select>
              <div className="admin-muted" style={{ fontSize: 12, marginTop: 6 }}>
                Итоговая схема: {Math.round(plan.cols * plan.cellSize * 10) / 10} ×{" "}
                {Math.round(plan.rows * plan.cellSize * 10) / 10} м, площадь{" "}
                {Math.round(plan.cols * plan.cellSize * plan.rows * plan.cellSize * 10) / 10} м².
                Стены и помещения за пределами новой сетки будут обрезаны.
              </div>
            </div>
            <div className="admin-muted" style={{ fontSize: 12 }}>
              Площадь помещений считается автоматически: количество клеток × площадь клетки.
            </div>
          </div>
          <div className="admin-modal__actions">
            <button className="admin-btn admin-btn--ghost" onClick={onClose}>
              Отмена
            </button>
            <button className="admin-btn admin-btn--primary" onClick={onApply}>
              <Save size={14} /> Применить к этажу
            </button>
          </div>
        </div>
      </div>
    </ModalPortal>
  );
}
