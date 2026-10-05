// =========================================================
// FILE: src/components/admin/rent/RentBuildingScheme.tsx
// Схема здания: этажи, офисы, привязка арендаторов.
// Интерактивное рисование прямоугольников-офисов, переключение
// этажей, отображение арендаторов цветом долга/просрочки.
// Хранение — через /api/admin/rent/building (settings fallback).
// =========================================================

"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Building2,
  Layers,
  Plus,
  Trash2,
  Pencil,
  Save,
  X,
  Move,
  AlertTriangle,
  CheckCircle2,
  Users,
  MapPin,
  Settings2,
  Eye,
  MousePointer2,
  Square,
  Ban,
} from "lucide-react";
import { ModalPortal } from "@/components/admin/ModalPortal";
import { useEscapeClose } from "@/hooks/use-escape-close";
import type { RentBuilding, RentOfficeUnit } from "@/lib/rent-building";
import type { RentTenant, RentInvoice, RentOrg } from "@/lib/rent-shared";
import { computeTenantState, rentFmt } from "@/lib/rent-shared";

type Props = {
  initialBuildings: RentBuilding[];
  initialOffices: RentOfficeUnit[];
  tenants: RentTenant[];
  invoices: RentInvoice[];
  orgs: RentOrg[];
  readOnly?: boolean;
};

type DrawMode = "view" | "draw";

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

export function RentBuildingScheme({
  initialBuildings,
  initialOffices,
  tenants,
  invoices,
  orgs,
  readOnly,
}: Props) {
  const router = useRouter();
  const [buildings, setBuildings] = useState<RentBuilding[]>(initialBuildings);
  const [offices, setOffices] = useState<RentOfficeUnit[]>(initialOffices);
  const [activeBuildingId, setActiveBuildingId] = useState<string>(initialBuildings[0]?.id || "main");
  const [activeFloor, setActiveFloor] = useState(1);
  const [mode, setMode] = useState<DrawMode>("view");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [drag, setDrag] = useState<null | { id: string; startX: number; startY: number; origX: number; origY: number }>(null);
  const [resizing, setResizing] = useState<null | { id: string; handle: string; startX: number; startY: number; orig: RentOfficeUnit }>(null);
  const [drawing, setDrawing] = useState<null | { x: number; y: number; w: number; h: number }>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [buildingModal, setBuildingModal] = useState<RentBuilding | null>(null);
  const [newBuildingMode, setNewBuildingMode] = useState(false);

  const canvasRef = useRef<HTMLDivElement | null>(null);

  const activeBuilding = useMemo(() => buildings.find((b) => b.id === activeBuildingId) || buildings[0], [buildings, activeBuildingId]);
  const floorOffices = useMemo(() => offices.filter((o) => o.buildingId === activeBuildingId && o.floor === activeFloor), [offices, activeBuildingId, activeFloor]);
  const tenantById = useMemo(() => new Map(tenants.map((t) => [t.id, t])), [tenants]);
  const today = useMemo(() => new Date().toISOString().slice(0, 10), []);

  const selectedOffice = useMemo(() => offices.find((o) => o.id === selectedId) || null, [offices, selectedId]);

  // Сброс этажа при смене здания
  useEffect(() => {
    if (activeBuilding && activeFloor > activeBuilding.floors) setActiveFloor(1);
  }, [activeBuilding, activeFloor]);

  // Синхронизация с сервером при монтировании (подтянуть свежие данные, если initial пустые)
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/admin/rent/building", { cache: "no-store" });
        if (!res.ok) return;
        const data = await res.json();
        if (cancelled) return;
        if (Array.isArray(data.buildings) && data.buildings.length) {
          setBuildings(data.buildings);
          if (!activeBuildingId || !data.buildings.some((b: any) => b.id === activeBuildingId)) {
            setActiveBuildingId(data.buildings[0].id);
          }
        }
        if (Array.isArray(data.offices)) setOffices(data.offices);
      } catch {}
    })();
    return () => { cancelled = true; };
  }, []);

  const officeState = useCallback(
    (office: RentOfficeUnit) => {
      if (!office.tenantId) return null;
      const tenant = tenantById.get(office.tenantId);
      if (!tenant) return null;
      return computeTenantState(tenant, invoices, today);
    },
    [tenantById, invoices, today]
  );

  const officeColor = useCallback(
    (office: RentOfficeUnit) => {
      if (office.color) return office.color;
      if (!office.tenantId) return "#e8eef6"; // пусто
      const st = officeState(office);
      if (!st) return "#e8eef6";
      if (st.overdue > 0) return "#fde8e6"; // просрочка
      if (st.debt > 0) return "#fdf3dc"; // долг
      return "#ebf4ee"; // нет долга
    },
    [officeState]
  );

  const officeBorder = useCallback(
    (office: RentOfficeUnit) => {
      if (!office.tenantId) return "var(--adm-border)";
      const st = officeState(office);
      if (!st) return "var(--adm-border)";
      if (st.overdue > 0) return "var(--adm-rust-line)";
      if (st.debt > 0) return "var(--adm-kraft-line)";
      return "var(--adm-pine-line)";
    },
    [officeState]
  );

  async function saveScheme(nextBuildings: RentBuilding[], nextOffices: RentOfficeUnit[]) {
    setSaving(true);
    setError("");
    setSuccess("");
    try {
      const res = await fetch("/api/admin/rent/building", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ buildings: nextBuildings, offices: nextOffices }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Не удалось сохранить схему");
      setBuildings(data.buildings || nextBuildings);
      setOffices(data.offices || nextOffices);
      setSuccess("Схема сохранена");
      setTimeout(() => setSuccess(""), 2000);
      router.refresh();
    } catch (e: any) {
      setError(e.message || "Ошибка сохранения");
    } finally {
      setSaving(false);
    }
  }

  function handleCanvasMouseDown(e: React.MouseEvent) {
    if (readOnly) return;
    if (mode !== "draw") return;
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    const x = clamp(((e.clientX - rect.left) / rect.width) * 100, 0, 95);
    const y = clamp(((e.clientY - rect.top) / rect.height) * 100, 0, 95);
    setDrawing({ x, y, w: 0, h: 0 });
    // track mouse move globally
    const onMove = (ev: MouseEvent) => {
      const w = clamp(((ev.clientX - rect.left) / rect.width) * 100 - x, 5, 100 - x);
      const h = clamp(((ev.clientY - rect.top) / rect.height) * 100 - y, 5, 100 - y);
      setDrawing({ x, y, w: Math.max(5, w), h: Math.max(5, h) });
    };
    const onUp = (ev: MouseEvent) => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      setDrawing((cur) => {
        if (!cur || cur.w < 5 || cur.h < 5) return null;
        const label = `Офис ${activeFloor}${String(floorOffices.length + 1).padStart(2, "0")}`;
        const newOffice: RentOfficeUnit = {
          id: `off-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
          buildingId: activeBuildingId,
          floor: activeFloor,
          label,
          x: Math.round(cur.x * 10) / 10,
          y: Math.round(cur.y * 10) / 10,
          w: Math.round(cur.w * 10) / 10,
          h: Math.round(cur.h * 10) / 10,
          tenantId: null,
        };
        const next = [...offices, newOffice];
        setOffices(next);
        setSelectedId(newOffice.id);
        setDrawing(null);
        // автосохранение
        void saveScheme(buildings, next);
        return null;
      });
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }

  function startDrag(e: React.MouseEvent, office: RentOfficeUnit) {
    if (readOnly || mode !== "view") return;
    e.stopPropagation();
    setSelectedId(office.id);
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    const startX = e.clientX;
    const startY = e.clientY;
    setDrag({ id: office.id, startX, startY, origX: office.x, origY: office.y });
    const onMove = (ev: MouseEvent) => {
      const dx = ((ev.clientX - startX) / rect.width) * 100;
      const dy = ((ev.clientY - startY) / rect.height) * 100;
      setOffices((prev) =>
        prev.map((o) =>
          o.id === office.id
            ? {
                ...o,
                x: clamp(Math.round((office.x + dx) * 10) / 10, 0, 100 - o.w),
                y: clamp(Math.round((office.y + dy) * 10) / 10, 0, 100 - o.h),
              }
            : o
        )
      );
    };
    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      setDrag(null);
      setOffices((cur) => {
        void saveScheme(buildings, cur);
        return cur;
      });
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }

  function startResize(e: React.MouseEvent, office: RentOfficeUnit, handle: string) {
    if (readOnly) return;
    e.stopPropagation();
    e.preventDefault();
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    setResizing({ id: office.id, handle, startX: e.clientX, startY: e.clientY, orig: office });
    const onMove = (ev: MouseEvent) => {
      const dx = ((ev.clientX - e.clientX) / rect.width) * 100;
      const dy = ((ev.clientY - e.clientY) / rect.height) * 100;
      setOffices((prev) =>
        prev.map((o) => {
          if (o.id !== office.id) return o;
          let { x, y, w, h } = office;
          if (handle.includes("e")) w = clamp(w + dx, 5, 100 - x);
          if (handle.includes("s")) h = clamp(h + dy, 5, 100 - y);
          if (handle.includes("w")) {
            const nx = clamp(x + dx, 0, x + w - 5);
            w = w - (nx - x);
            x = nx;
          }
          if (handle.includes("n")) {
            const ny = clamp(y + dy, 0, y + h - 5);
            h = h - (ny - y);
            y = ny;
          }
          return { ...o, x: Math.round(x * 10) / 10, y: Math.round(y * 10) / 10, w: Math.round(w * 10) / 10, h: Math.round(h * 10) / 10 };
        })
      );
    };
    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      setResizing(null);
      setOffices((cur) => {
        void saveScheme(buildings, cur);
        return cur;
      });
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }

  function updateSelectedOffice(patch: Partial<RentOfficeUnit>) {
    if (!selectedId) return;
    const next = offices.map((o) => (o.id === selectedId ? { ...o, ...patch } : o));
    setOffices(next);
  }

  function commitSelectedOffice() {
    if (!selectedId) return;
    void saveScheme(buildings, offices);
  }

  function deleteSelectedOffice() {
    if (!selectedId) return;
    if (!confirm("Удалить офис со схемы?")) return;
    const next = offices.filter((o) => o.id !== selectedId);
    setOffices(next);
    setSelectedId(null);
    void saveScheme(buildings, next);
  }

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
    if (!name) { setError("Укажите название корпуса"); return; }
    const floors = clamp(Math.round(buildingModal.floors), 1, 20);
    if (newBuildingMode) {
      const nextBuildings = [...buildings, { ...buildingModal, name, floors }];
      setBuildings(nextBuildings);
      setActiveBuildingId(buildingModal.id);
      setActiveFloor(1);
      void saveScheme(nextBuildings, offices);
    } else {
      const nextBuildings = buildings.map((b) => (b.id === buildingModal.id ? { ...buildingModal, name, floors } : b));
      const prevFloors = buildings.find((b) => b.id === buildingModal.id)?.floors || floors;
      let nextOffices = offices;
      if (floors < prevFloors) {
        nextOffices = offices.map((o) => (o.buildingId === buildingModal.id && o.floor > floors ? { ...o, floor: floors } : o));
        setOffices(nextOffices);
      }
      setBuildings(nextBuildings);
      void saveScheme(nextBuildings, nextOffices);
    }
    setBuildingModal(null);
  }

  function deleteBuilding(id: string) {
    if (buildings.length <= 1) { setError("Нельзя удалить единственный корпус"); return; }
    if (!confirm("Удалить корпус со всеми офисами?")) return;
    const nextBuildings = buildings.filter((b) => b.id !== id);
    const nextOffices = offices.filter((o) => o.buildingId !== id);
    setBuildings(nextBuildings);
    setOffices(nextOffices);
    setActiveBuildingId(nextBuildings[0].id);
    setActiveFloor(1);
    setSelectedId(null);
    void saveScheme(nextBuildings, nextOffices);
  }

  const stats = useMemo(() => {
    const total = floorOffices.length;
    const occupied = floorOffices.filter((o) => o.tenantId).length;
    const vacant = total - occupied;
    const overdue = floorOffices.filter((o) => {
      const st = officeState(o);
      return st && st.overdue > 0;
    }).length;
    return { total, occupied, vacant, overdue };
  }, [floorOffices, officeState]);

  return (
    <div className="rent-scheme">
      {/* Тулбар */}
      <div className="rent-scheme__toolbar">
        <div className="rent-scheme__buildings">
          <Building2 size={14} style={{ color: "var(--adm-steel)" }} />
          <select
            className="admin-select"
            value={activeBuildingId}
            onChange={(e) => setActiveBuildingId(e.target.value)}
            style={{ minWidth: 180, height: 34 }}
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
              <button className="admin-btn admin-btn--ghost admin-btn--sm" onClick={() => activeBuilding && editBuilding(activeBuilding)} title="Настроить корпус">
                <Settings2 size={13} />
              </button>
              {buildings.length > 1 && activeBuilding && (
                <button className="admin-btn admin-btn--ghost admin-btn--sm" onClick={() => deleteBuilding(activeBuilding.id)} title="Удалить корпус">
                  <Trash2 size={13} />
                </button>
              )}
            </>
          )}
        </div>

        <div className="rent-scheme__actions">
          <div className="rent-scheme__mode">
            <button
              className={`admin-filter ${mode === "view" ? "admin-filter--active" : ""}`}
              onClick={() => setMode("view")}
              title="Выбор и перемещение офисов"
            >
              <MousePointer2 size={13} /> Выбор
            </button>
            {!readOnly && (
              <button
                className={`admin-filter ${mode === "draw" ? "admin-filter--active" : ""}`}
                onClick={() => setMode("draw")}
                title="Рисовать новые офисы мышью"
              >
                <Square size={13} /> Рисовать
              </button>
            )}
          </div>
          <span className="admin-muted" style={{ fontSize: 11 }}>
            {mode === "draw" ? "Тяните мышью по плану, чтобы нарисовать офис" : "Перетаскивайте офисы, тяните за угол для размера"}
          </span>
        </div>
      </div>

      {/* Переключение этажей */}
      <div className="rent-scheme__floors">
        <Layers size={13} />
        {Array.from({ length: activeBuilding?.floors || 3 }, (_, i) => i + 1).map((floor) => {
          const count = offices.filter((o) => o.buildingId === activeBuildingId && o.floor === floor).length;
          return (
            <button
              key={floor}
              className={`rent-scheme__floor ${activeFloor === floor ? "rent-scheme__floor--active" : ""}`}
              onClick={() => setActiveFloor(floor)}
            >
              {floor} этаж
              <span className="rent-scheme__floor-count">{count}</span>
            </button>
          );
        })}
        <span className="rent-scheme__stats">
          <span style={{ color: "var(--adm-pine)" }}>{stats.occupied} занято</span>
          <span style={{ color: "var(--adm-sand)" }}>{stats.vacant} свободно</span>
          {stats.overdue > 0 && <span style={{ color: "var(--adm-rust)", fontWeight: 700 }}>{stats.overdue} просрочка</span>}
        </span>
      </div>

      {error && <div className="admin-error" style={{ display: "flex", gap: 6, alignItems: "center" }}><AlertTriangle size={14} /> {error}</div>}
      {success && <div className="admin-success" style={{ display: "inline-flex", gap: 6 }}><CheckCircle2 size={14} /> {success}</div>}

      <div className="rent-scheme__body">
        {/* План */}
        <div
          className={`rent-scheme__canvas ${mode === "draw" ? "rent-scheme__canvas--draw" : ""}`}
          ref={canvasRef}
          onMouseDown={handleCanvasMouseDown}
          onClick={(e) => {
            if (e.target === canvasRef.current) setSelectedId(null);
          }}
        >
          {/* Сетка */}
          <div className="rent-scheme__grid" />
          {/* Офисы */}
          {floorOffices.map((office) => {
            const tenant = office.tenantId ? tenantById.get(office.tenantId) : null;
            const st = officeState(office);
            const isSelected = selectedId === office.id;
            const isDragging = drag?.id === office.id;
            return (
              <div
                key={office.id}
                className={`rent-office ${isSelected ? "rent-office--selected" : ""} ${isDragging ? "rent-office--dragging" : ""}`}
                style={{
                  left: `${office.x}%`,
                  top: `${office.y}%`,
                  width: `${office.w}%`,
                  height: `${office.h}%`,
                  background: officeColor(office),
                  borderColor: officeBorder(office),
                }}
                onMouseDown={(e) => startDrag(e, office)}
                onClick={(e) => {
                  e.stopPropagation();
                  setSelectedId(office.id);
                }}
                title={tenant ? `${office.label} · ${tenant.name}${st ? ` · долг ${rentFmt(st.debt)} ₽` : ""}` : office.label}
              >
                <div className="rent-office__label">{office.label}</div>
                {tenant ? (
                  <>
                    <div className="rent-office__tenant">{tenant.name}</div>
                    {tenant.office && tenant.office !== office.label && <div className="rent-office__hint">{tenant.office}</div>}
                    {office.area && <div className="rent-office__area">{office.area} м²</div>}
                    {st && (st.overdue > 0 || st.debt > 0) && (
                      <div className={`rent-office__badge ${st.overdue > 0 ? "rent-office__badge--overdue" : "rent-office__badge--debt"}`}>
                        {st.overdue > 0 ? `${rentFmt(st.overdue)} ₽` : `${rentFmt(st.debt)} ₽`}
                      </div>
                    )}
                  </>
                ) : (
                  <div className="rent-office__tenant rent-office__tenant--vacant">
                    <Ban size={10} /> свободно
                  </div>
                )}
                {isSelected && !readOnly && (
                  <>
                    <button className="rent-office__handle rent-office__handle--nw" onMouseDown={(e) => startResize(e, office, "nw")} title="Размер" />
                    <button className="rent-office__handle rent-office__handle--ne" onMouseDown={(e) => startResize(e, office, "ne")} />
                    <button className="rent-office__handle rent-office__handle--sw" onMouseDown={(e) => startResize(e, office, "sw")} />
                    <button className="rent-office__handle rent-office__handle--se" onMouseDown={(e) => startResize(e, office, "se")} />
                    <span className="rent-office__move"><Move size={10} /></span>
                  </>
                )}
              </div>
            );
          })}
          {drawing && (
            <div
              className="rent-office rent-office--drawing"
              style={{ left: `${drawing.x}%`, top: `${drawing.y}%`, width: `${drawing.w}%`, height: `${drawing.h}%` }}
            />
          )}
          {floorOffices.length === 0 && !drawing && (
            <div className="rent-scheme__empty">
              <MapPin size={18} />
              <div>На {activeFloor}-м этаже пока нет офисов</div>
              {!readOnly && mode === "draw" && <div className="admin-muted" style={{ fontSize: 12 }}>Тяните мышью, чтобы нарисовать первый офис</div>}
              {!readOnly && mode !== "draw" && <button className="admin-btn admin-btn--primary admin-btn--sm" onClick={() => setMode("draw")}><Plus size={13} /> Нарисовать офис</button>}
            </div>
          )}
          <div className="rent-scheme__ruler rent-scheme__ruler--x" />
          <div className="rent-scheme__ruler rent-scheme__ruler--y" />
        </div>

        {/* Боковая панель выбранного офиса */}
        <div className="rent-scheme__side">
          {selectedOffice ? (
            <div className="admin-card">
              <div className="admin-card__head">
                <h3 className="admin-card__title" style={{ display: "flex", gap: 6, alignItems: "center" }}>
                  <Building2 size={14} /> {selectedOffice.label}
                </h3>
                {!readOnly && (
                  <button className="admin-btn admin-btn--icon admin-btn--ghost" style={{ width: 28, height: 28 }} onClick={deleteSelectedOffice} title="Удалить офис">
                    <Trash2 size={13} />
                  </button>
                )}
              </div>
              <div className="admin-card__pad" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                <div className="admin-field">
                  <label className="admin-label">Название офиса</label>
                  <input
                    className="admin-input"
                    value={selectedOffice.label}
                    onChange={(e) => updateSelectedOffice({ label: e.target.value })}
                    onBlur={commitSelectedOffice}
                    placeholder="Офис 214"
                    disabled={readOnly}
                  />
                </div>
                <div className="admin-grid-2">
                  <div className="admin-field">
                    <label className="admin-label">Этаж</label>
                    <select
                      className="admin-select"
                      value={selectedOffice.floor}
                      onChange={(e) => {
                        const floor = Number(e.target.value);
                        updateSelectedOffice({ floor });
                        setTimeout(() => commitSelectedOffice(), 0);
                      }}
                      disabled={readOnly}
                    >
                      {Array.from({ length: activeBuilding?.floors || 1 }, (_, i) => i + 1).map((f) => (
                        <option key={f} value={f}>{f} этаж</option>
                      ))}
                    </select>
                  </div>
                  <div className="admin-field">
                    <label className="admin-label">Площадь, м²</label>
                    <input
                      type="number"
                      className="admin-input"
                      value={selectedOffice.area ?? ""}
                      onChange={(e) => updateSelectedOffice({ area: e.target.value ? Number(e.target.value) : null })}
                      onBlur={commitSelectedOffice}
                      placeholder="—"
                      disabled={readOnly}
                    />
                  </div>
                </div>
                <div className="admin-field">
                  <label className="admin-label">Арендатор</label>
                  <select
                    className="admin-select"
                    value={selectedOffice.tenantId || ""}
                    onChange={(e) => {
                      const tenantId = e.target.value || null;
                      updateSelectedOffice({ tenantId });
                      // подсказка: если у арендатора есть офис, подставить его название?
                      setTimeout(() => commitSelectedOffice(), 0);
                    }}
                    disabled={readOnly}
                  >
                    <option value="">— свободно —</option>
                    {tenants
                      .filter((t) => t.status === "active" || t.id === selectedOffice.tenantId)
                      .map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.name} {t.office ? `· ${t.office}` : ""} {(() => { const s = computeTenantState(t, invoices, today); return s.overdue > 0 ? `· 🔴 ${rentFmt(s.overdue)}` : s.debt > 0 ? `· 🟡 ${rentFmt(s.debt)}` : ""; })()}
                        </option>
                      ))}
                  </select>
                </div>
                {selectedOffice.tenantId && (() => {
                  const tenant = tenantById.get(selectedOffice.tenantId!);
                  if (!tenant) return null;
                  const st = computeTenantState(tenant, invoices, today);
                  return (
                    <div style={{ background: "var(--adm-paper)", border: "1px solid var(--adm-border)", borderRadius: 8, padding: 10, display: "flex", flexDirection: "column", gap: 6 }}>
                      <div style={{ fontWeight: 700, fontSize: 13 }}>{tenant.name}</div>
                      <div className="admin-muted" style={{ fontSize: 11 }}>{tenant.phone || tenant.email || ""} {tenant.contactName ? `· ${tenant.contactName}` : ""}</div>
                      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                        <span className={`admin-badge ${st.overdue > 0 ? "admin-badge--red" : st.debt > 0 ? "admin-badge--amber" : "admin-badge--green"}`}>
                          {st.overdue > 0 ? `Просрочка ${rentFmt(st.overdue)} ₽` : st.debt > 0 ? `Долг ${rentFmt(st.debt)} ₽` : "Нет долга"}
                        </span>
                        <span className="admin-badge admin-badge--muted">{rentFmt(tenant.monthlyRent)} ₽/мес</span>
                      </div>
                    </div>
                  );
                })()}
                <div className="admin-field">
                  <label className="admin-label">Координаты (x, y, w, h %)</label>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
                    <input className="admin-input" type="number" value={selectedOffice.x} onChange={(e) => updateSelectedOffice({ x: Number(e.target.value) })} onBlur={commitSelectedOffice} disabled={readOnly} />
                    <input className="admin-input" type="number" value={selectedOffice.y} onChange={(e) => updateSelectedOffice({ y: Number(e.target.value) })} onBlur={commitSelectedOffice} disabled={readOnly} />
                    <input className="admin-input" type="number" value={selectedOffice.w} onChange={(e) => updateSelectedOffice({ w: Number(e.target.value) })} onBlur={commitSelectedOffice} disabled={readOnly} />
                    <input className="admin-input" type="number" value={selectedOffice.h} onChange={(e) => updateSelectedOffice({ h: Number(e.target.value) })} onBlur={commitSelectedOffice} disabled={readOnly} />
                  </div>
                </div>
                {!readOnly && (
                  <div style={{ display: "flex", gap: 6 }}>
                    <button className="admin-btn admin-btn--primary admin-btn--sm" onClick={commitSelectedOffice} disabled={saving}>
                      <Save size={13} /> Сохранить
                    </button>
                    <button className="admin-btn admin-btn--ghost admin-btn--sm" onClick={() => setSelectedId(null)}>
                      <Eye size={13} /> Готово
                    </button>
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="admin-card">
              <div className="admin-card__pad">
                <div style={{ display: "flex", gap: 8, alignItems: "center", color: "var(--adm-ink-soft)", fontWeight: 600, marginBottom: 6 }}>
                  <Users size={14} /> Офисы на этаже
                </div>
                {floorOffices.length === 0 ? (
                  <div className="admin-muted" style={{ fontSize: 13 }}>Выберите офис на плане или нарисуйте новый.</div>
                ) : (
                  <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                    {floorOffices.map((o) => {
                      const tenant = o.tenantId ? tenantById.get(o.tenantId) : null;
                      const st = officeState(o);
                      return (
                        <button
                          key={o.id}
                          onClick={() => setSelectedId(o.id)}
                          className="rent-scheme__list-item"
                          style={{ borderColor: selectedId === o.id ? "var(--adm-steel-line)" : undefined, background: selectedId === o.id ? "var(--adm-steel-pale)" : undefined }}
                        >
                          <span style={{ fontWeight: 700, flex: 1, textAlign: "left", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{o.label}</span>
                          <span className="admin-muted" style={{ fontSize: 11, maxWidth: 120, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                            {tenant ? tenant.name : "свободно"}
                          </span>
                          {st && st.overdue > 0 ? <span className="admin-badge admin-badge--red" style={{ fontSize: 10 }}>{rentFmt(st.overdue)} ₽</span> : st && st.debt > 0 ? <span className="admin-badge admin-badge--amber" style={{ fontSize: 10 }}>{rentFmt(st.debt)} ₽</span> : null}
                        </button>
                      );
                    })}
                  </div>
                )}
                <div style={{ marginTop: 10, display: "flex", gap: 6 }}>
                  {!readOnly && <button className="admin-btn admin-btn--primary admin-btn--sm" onClick={() => setMode("draw")}><Plus size={13} /> Нарисовать офис</button>}
                </div>
              </div>
            </div>
          )}

          {/* Легенда */}
          <div className="admin-card">
            <div className="admin-card__pad">
              <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".05em", color: "var(--adm-muted)", marginBottom: 8 }}>Легенда</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 6, fontSize: 12 }}>
                <span style={{ display: "flex", gap: 8, alignItems: "center" }}><span style={{ width: 14, height: 14, background: "#e8eef6", border: "1px solid var(--adm-border)", borderRadius: 3 }} /> Свободно</span>
                <span style={{ display: "flex", gap: 8, alignItems: "center" }}><span style={{ width: 14, height: 14, background: "#ebf4ee", border: "1px solid var(--adm-pine-line)", borderRadius: 3 }} /> Занято · нет долга</span>
                <span style={{ display: "flex", gap: 8, alignItems: "center" }}><span style={{ width: 14, height: 14, background: "#fdf3dc", border: "1px solid var(--adm-kraft-line)", borderRadius: 3 }} /> Долг</span>
                <span style={{ display: "flex", gap: 8, alignItems: "center" }}><span style={{ width: 14, height: 14, background: "#fde8e6", border: "1px solid var(--adm-rust-line)", borderRadius: 3 }} /> Просрочка</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Модалка здания */}
      {buildingModal && (
        <ModalPortal>
          <div className="admin-modal-overlay" data-admin="true" onClick={() => setBuildingModal(null)}>
            <div className="admin-modal" style={{ maxWidth: 460 }} onClick={(e) => e.stopPropagation()}>
              <div className="admin-modal__head">
                <h3 className="admin-modal__title">{newBuildingMode ? "Новый корпус" : "Настройка корпуса"}</h3>
                <button className="admin-modal__close" onClick={() => setBuildingModal(null)}><X size={16} /></button>
              </div>
              <div className="admin-form" style={{ padding: "0 20px" }}>
                <div className="admin-field">
                  <label className="admin-label">Название *</label>
                  <input className="admin-input" value={buildingModal.name} onChange={(e) => setBuildingModal({ ...buildingModal, name: e.target.value })} placeholder="Главный корпус" />
                </div>
                <div className="admin-field">
                  <label className="admin-label">Адрес</label>
                  <input className="admin-input" value={buildingModal.address || ""} onChange={(e) => setBuildingModal({ ...buildingModal, address: e.target.value })} placeholder="ул. Примерная, 1" />
                </div>
                <div className="admin-field">
                  <label className="admin-label">Этажей</label>
                  <input type="number" min={1} max={20} className="admin-input" value={buildingModal.floors} onChange={(e) => setBuildingModal({ ...buildingModal, floors: Number(e.target.value) })} />
                </div>
              </div>
              <div className="admin-modal__actions">
                <button className="admin-btn admin-btn--ghost" onClick={() => setBuildingModal(null)}>Отмена</button>
                <button className="admin-btn admin-btn--primary" onClick={saveBuildingModal}><Save size={14} /> Сохранить</button>
              </div>
            </div>
          </div>
        </ModalPortal>
      )}
    </div>
  );
}
