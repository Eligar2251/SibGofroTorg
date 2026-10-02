// =========================================================
// FILE: src/components/admin/AdminNavCustomizer.tsx
// Модалка «Настройка меню» — гибкая настройка навигации админки
// для ТЕКУЩЕГО пользователя:
//   • скрытие ненужных разделов (глаз);
//   • порядок разделов (перетаскивание за рукоятку + стрелки);
//   • группы-выпадашки: заголовок + иконка, разделы назначаются
//     в группу выпадающим списком прямо на строке.
// Сохранение — на сервер (/api/admin/nav-settings), поэтому
// настройка привязана к учётной записи, а не к браузеру.
// =========================================================

"use client";

import { useEffect, useMemo, useRef, useState, type HTMLAttributes } from "react";
import {
  Check,
  ChevronDown,
  ChevronUp,
  Eye,
  EyeOff,
  GripVertical,
  Loader2,
  Plus,
  RotateCcw,
  Save,
  SlidersHorizontal,
  Trash2,
  X,
} from "lucide-react";
import { ModalPortal } from "./ModalPortal";
import {
  getNavIcon,
  NAV_GROUP_ICON_CHOICES,
  NAV_ICON_MAP,
  normalizeNavSettings,
  type AdminNavItemDef,
  type AdminNavSettingsDto,
} from "@/lib/admin-nav";
import styles from "./AdminNavCustomizer.module.css";

/** Строка редактора: одиночный раздел или группа. */
type EditorRow =
  | { kind: "item"; key: string }
  | { kind: "group"; id: string; title: string; icon: string; items: string[] };

/** Восстанавливает состояние редактора из сохранённых настроек. */
function settingsToEditor(
  available: AdminNavItemDef[],
  settings: AdminNavSettingsDto | null
): { rows: EditorRow[]; hidden: string[] } {
  const known = new Set(available.map((def) => def.key));
  const rows: EditorRow[] = [];
  const placed = new Set<string>();

  for (const entry of settings?.entries ?? []) {
    if (typeof entry === "string") {
      if (known.has(entry) && !placed.has(entry)) {
        placed.add(entry);
        rows.push({ kind: "item", key: entry });
      }
      continue;
    }
    const items = entry.items.filter((key) => known.has(key) && !placed.has(key));
    for (const key of items) placed.add(key);
    rows.push({ kind: "group", id: entry.id, title: entry.title, icon: entry.icon, items });
  }

  const hidden = (settings?.hidden ?? []).filter(
    (key) => known.has(key) && !placed.has(key)
  );
  const hiddenSet = new Set(hidden);
  for (const def of available) {
    if (!placed.has(def.key) && !hiddenSet.has(def.key)) {
      rows.push({ kind: "item", key: def.key });
    }
  }
  return { rows, hidden };
}

function editorToDto(rows: EditorRow[], hidden: string[]): AdminNavSettingsDto {
  return {
    version: 1,
    entries: rows.map((row) =>
      row.kind === "item"
        ? row.key
        : {
            id: row.id,
            title: row.title.trim() || "Группа",
            icon: row.icon,
            items: row.items,
          }
    ),
    hidden,
  };
}

function makeGroupId(): string {
  return `group-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

export function AdminNavCustomizer({
  open,
  availableItems,
  settings,
  onClose,
  onSaved,
}: {
  open: boolean;
  /** Разделы, доступные роли текущего пользователя. */
  availableItems: AdminNavItemDef[];
  /** Текущие сохранённые настройки (или отсутствие таковых). */
  settings: AdminNavSettingsDto | null;
  onClose: () => void;
  /** Вызывается после сохранения/сброса — оболочка сразу перестраивает меню. */
  onSaved: (settings: AdminNavSettingsDto | null) => void;
}) {
  const [rows, setRows] = useState<EditorRow[]>([]);
  const [hidden, setHidden] = useState<string[]>([]);
  const [hiddenOpen, setHiddenOpen] = useState(true);
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [iconPickerFor, setIconPickerFor] = useState<string | null>(null);
  const [dragArmed, setDragArmed] = useState<number | null>(null);
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const modalRef = useRef<HTMLDivElement>(null);
  const focusGroupId = useRef<string | null>(null);

  const itemBy = useMemo(
    () => new Map(availableItems.map((def) => [def.key, def])),
    [availableItems]
  );
  const groups = rows.filter(
    (row): row is Extract<EditorRow, { kind: "group" }> => row.kind === "group"
  );
  const groupOf = useMemo(() => {
    const map = new Map<string, string>();
    for (const group of groups) {
      for (const key of group.items) map.set(key, group.id);
    }
    return map;
  }, [groups]);

  // Первичное наполнение при каждом открытии (и при смене сохранённого).
  useEffect(() => {
    if (!open) return;
    const editor = settingsToEditor(availableItems, settings);
    setRows(editor.rows);
    setHidden(editor.hidden);
    setStatus("idle");
    setIconPickerFor(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Escape: сначала закрываем выбор иконки, потом саму модалку.
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (iconPickerFor) setIconPickerFor(null);
      else onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, iconPickerFor, onClose]);

  useEffect(() => {
    if (open) modalRef.current?.focus();
  }, [open]);

  if (!open) return null;

  // ── Операции со строками ──

  function moveTopRow(from: number, to: number) {
    setRows((prev) => {
      if (from === to || from < 0 || to < 0 || from >= prev.length || to >= prev.length) {
        return prev;
      }
      const next = [...prev];
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      return next;
    });
  }

  function moveInGroup(groupId: string, from: number, to: number) {
    setRows((prev) =>
      prev.map((row) => {
        if (row.kind !== "group" || row.id !== groupId) return row;
        if (from === to || from < 0 || to < 0 || from >= row.items.length || to >= row.items.length) {
          return row;
        }
        const items = [...row.items];
        const [moved] = items.splice(from, 1);
        items.splice(to, 0, moved);
        return { ...row, items };
      })
    );
  }

  /** Убирает раздел отовсюду (верхний уровень/группы), не трогая скрытые. */
  function removeKeyEverywhere(key: string): void {
    setRows((prev) =>
      prev
        .map((row) =>
          row.kind === "group"
            ? { ...row, items: row.items.filter((k) => k !== key) }
            : row
        )
        .filter((row) => !(row.kind === "item" && row.key === key))
    );
  }

  function hideKey(key: string) {
    removeKeyEverywhere(key);
    setHidden((prev) => (prev.includes(key) ? prev : [...prev, key]));
  }

  function showKey(key: string) {
    setHidden((prev) => prev.filter((k) => k !== key));
    setRows((prev) => [...prev, { kind: "item", key }]);
  }

  /** Перенос раздела в группу (или обратно наверх: groupId = null). */
  function assignGroup(key: string, groupId: string | null) {
    setRows((prev) => {
      const topIdx = prev.findIndex((row) => row.kind === "item" && row.key === key);
      const ownerId = groupOf.get(key);
      const ownerIdx = ownerId
        ? prev.findIndex((row) => row.kind === "group" && row.id === ownerId)
        : -1;

      const without = prev
        .map((row) =>
          row.kind === "group"
            ? { ...row, items: row.items.filter((k) => k !== key) }
            : row
        )
        .filter((row) => !(row.kind === "item" && row.key === key));

      if (!groupId) {
        const base = topIdx !== -1 ? topIdx : ownerIdx !== -1 ? ownerIdx + 1 : without.length;
        const insertAt = Math.max(0, Math.min(base, without.length));
        without.splice(insertAt, 0, { kind: "item", key });
        return without;
      }
      return without.map((row) =>
        row.kind === "group" && row.id === groupId
          ? { ...row, items: [...row.items, key] }
          : row
      );
    });
  }

  function addGroup() {
    const id = makeGroupId();
    focusGroupId.current = id;
    setRows((prev) => [
      ...prev,
      { kind: "group", id, title: "Новая группа", icon: "Folder", items: [] },
    ]);
  }

  function deleteGroup(groupId: string) {
    setRows((prev) => {
      const idx = prev.findIndex((row) => row.kind === "group" && row.id === groupId);
      if (idx === -1) return prev;
      const group = prev[idx];
      if (group.kind !== "group") return prev;
      const members: EditorRow[] = group.items.map((key) => ({ kind: "item", key }));
      const next = prev.filter((_, i) => i !== idx);
      next.splice(idx, 0, ...members);
      return next;
    });
  }

  function patchGroup(groupId: string, patch: Partial<Extract<EditorRow, { kind: "group" }>>) {
    setRows((prev) =>
      prev.map((row) =>
        row.kind === "group" && row.id === groupId ? { ...row, ...patch } : row
      )
    );
  }

  // ── Сохранение / сброс ──

  async function handleSave() {
    setStatus("saving");
    const dto = editorToDto(rows, hidden);
    try {
      const res = await fetch("/api/admin/nav-settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ settings: dto }),
      });
      if (!res.ok) throw new Error();
      const data = (await res.json()) as { settings?: AdminNavSettingsDto | null };
      onSaved(normalizeNavSettings(data.settings, [...itemBy.keys()]) ?? dto);
      setStatus("saved");
    } catch {
      setStatus("error");
    }
  }

  async function handleReset() {
    if (!window.confirm("Сбросить меню к виду по умолчанию? Группы будут удалены.")) return;
    setStatus("saving");
    try {
      await fetch("/api/admin/nav-settings", { method: "DELETE" });
    } catch {
      /* даже если сервер недоступен — возвращаем вид по умолчанию локально */
    }
    const editor = settingsToEditor(availableItems, null);
    setRows(editor.rows);
    setHidden(editor.hidden);
    onSaved(null);
    setStatus("saved");
  }

  // ── Рендер вспомогательных элементов ──

  function renderGroupSelect(key: string) {
    const current = groupOf.get(key) ?? "";
    return (
      <select
        className={`${styles.groupSelect}${current ? ` ${styles.groupSelectInGroup}` : ""}`}
        value={current}
        onChange={(event) => assignGroup(key, event.target.value || null)}
        aria-label="Группа раздела"
        title="В какую группу входит раздел"
      >
        <option value="">Без группы</option>
        {groups.map((group) => (
          <option key={group.id} value={group.id}>
            {group.title.trim() || "Группа"}
          </option>
        ))}
      </select>
    );
  }

  function renderArrows(onUp: () => void, onDown: () => void, upDisabled: boolean, downDisabled: boolean) {
    return (
      <>
        <button
          type="button"
          className={styles.miniBtn}
          onClick={onUp}
          disabled={upDisabled}
          aria-label="Переместить выше"
          title="Выше"
        >
          <ChevronUp size={14} />
        </button>
        <button
          type="button"
          className={styles.miniBtn}
          onClick={onDown}
          disabled={downDisabled}
          aria-label="Переместить ниже"
          title="Ниже"
        >
          <ChevronDown size={14} />
        </button>
      </>
    );
  }

  function renderItemRow(
    key: string,
    opts: { index: number; inGroup?: { id: string; index: number; total: number } },
    extra?: HTMLAttributes<HTMLDivElement>
  ) {
    const def = itemBy.get(key);
    if (!def) return null;
    const Icon = getNavIcon(def.icon);
    const inGroup = opts.inGroup;
    return (
      <div
        key={key}
        {...extra}
        className={`${styles.row}${inGroup ? ` ${styles.memberRow}` : ""}${extra?.className ? ` ${extra.className}` : ""}`}
      >
        {!inGroup && (
          <span
            className={styles.grip}
            onPointerDown={() => setDragArmed(opts.index)}
            title="Перетащите, чтобы изменить порядок"
            aria-hidden="true"
          >
            <GripVertical size={15} />
          </span>
        )}
        <span className={styles.rowIcon}>
          <Icon size={15} aria-hidden="true" />
        </span>
        <span className={styles.rowLabel}>{def.label}</span>
        {renderGroupSelect(key)}
        <span className={styles.tools}>
          {inGroup
            ? renderArrows(
                () => moveInGroup(inGroup.id, inGroup.index, inGroup.index - 1),
                () => moveInGroup(inGroup.id, inGroup.index, inGroup.index + 1),
                inGroup.index === 0,
                inGroup.index >= inGroup.total - 1
              )
            : renderArrows(
                () => moveTopRow(opts.index, opts.index - 1),
                () => moveTopRow(opts.index, opts.index + 1),
                opts.index === 0,
                opts.index >= rows.length - 1
              )}
          <button
            type="button"
            className={`${styles.miniBtn} ${styles.miniBtnDanger}`}
            onClick={() => hideKey(key)}
            aria-label={`Скрыть раздел «${def.label}»`}
            title="Скрыть раздел"
          >
            <EyeOff size={14} />
          </button>
        </span>
      </div>
    );
  }

  function renderTopRow(row: EditorRow, index: number) {
    if (row.kind === "item") {
      return renderItemRow(
        row.key,
        { index },
        {
          draggable: dragArmed === index,
          onDragStart: (event) => {
            setDragIdx(index);
            event.dataTransfer.effectAllowed = "move";
            try {
              event.dataTransfer.setData("text/plain", row.key);
            } catch {
              /* старые браузеры */
            }
          },
          onDragEnter: () => {
            if (dragIdx === null || dragIdx === index) return;
            moveTopRow(dragIdx, index);
            setDragIdx(index);
          },
          onDragOver: (event) => event.preventDefault(),
          onDrop: (event) => event.preventDefault(),
          onDragEnd: () => {
            setDragIdx(null);
            setDragArmed(null);
          },
          className: dragIdx === index ? styles.rowDragging : undefined,
        }
      );
    }

    const GroupIcon = getNavIcon(row.icon);
    return (
      <div
        key={row.id}
        className={`${styles.groupRow}${dragIdx === index ? ` ${styles.rowDragging}` : ""}`}
        draggable={dragArmed === index}
        onDragStart={(event) => {
          setDragIdx(index);
          event.dataTransfer.effectAllowed = "move";
        }}
        onDragEnter={() => {
          if (dragIdx === null || dragIdx === index) return;
          moveTopRow(dragIdx, index);
          setDragIdx(index);
        }}
        onDragOver={(event) => event.preventDefault()}
        onDrop={(event) => event.preventDefault()}
        onDragEnd={() => {
          setDragIdx(null);
          setDragArmed(null);
        }}
      >
        <div className={styles.groupHead}>
          <span
            className={styles.grip}
            onPointerDown={() => setDragArmed(index)}
            title="Перетащите, чтобы изменить порядок"
            aria-hidden="true"
          >
            <GripVertical size={15} />
          </span>
          <button
            type="button"
            className={styles.groupIconBtn}
            onClick={() => setIconPickerFor(row.id)}
            aria-label="Выбрать иконку группы"
            title="Иконка группы"
          >
            <GroupIcon size={16} />
          </button>
          <input
            ref={(node) => {
              if (node && focusGroupId.current === row.id) {
                focusGroupId.current = null;
                node.focus();
                node.select();
              }
            }}
            className={styles.groupTitleInput}
            value={row.title}
            maxLength={48}
            onChange={(event) => patchGroup(row.id, { title: event.target.value })}
            placeholder="Название группы"
            aria-label="Название группы"
          />
          <span className={styles.groupMeta}>{row.items.length}</span>
          <span className={styles.tools}>
            {renderArrows(
              () => moveTopRow(index, index - 1),
              () => moveTopRow(index, index + 1),
              index === 0,
              index >= rows.length - 1
            )}
            <button
              type="button"
              className={`${styles.miniBtn} ${styles.miniBtnDanger}`}
              onClick={() => deleteGroup(row.id)}
              aria-label="Удалить группу (разделы вернутся в меню)"
              title="Удалить группу (разделы вернутся в меню)"
            >
              <Trash2 size={14} />
            </button>
          </span>
        </div>
        {row.items.length === 0 ? (
          <div className={styles.groupEmpty}>
            Пустая группа — назначьте разделы через список «Без группы» на их строках.
          </div>
        ) : (
          <div className={styles.groupMembers}>
            {row.items.map((key, memberIndex) =>
              renderItemRow(key, {
                index,
                inGroup: { id: row.id, index: memberIndex, total: row.items.length },
              })
            )}
          </div>
        )}
      </div>
    );
  }

  const pickerGroup = iconPickerFor
    ? rows.find((row): row is Extract<EditorRow, { kind: "group" }> => row.kind === "group" && row.id === iconPickerFor)
    : undefined;

  return (
    <ModalPortal>
      <div
        className={styles.overlay}
        onMouseDown={(event) => {
          if (event.target === event.currentTarget) onClose();
        }}
      >
        <div
          ref={modalRef}
          className={styles.modal}
          role="dialog"
          aria-modal="true"
          aria-label="Настройка меню админ-панели"
          tabIndex={-1}
        >
          <div className={styles.head}>
            <span className={styles.headIcon}>
              <SlidersHorizontal size={17} aria-hidden="true" />
            </span>
            <div className={styles.headTexts}>
              <h2 className={styles.title}>Настройка меню</h2>
              <p className={styles.subtitle}>
                Порядок, скрытие разделов и группы-выпадашки — сохраняются для вашей
                учётной записи и применяются на всех устройствах.
              </p>
            </div>
            <button
              type="button"
              className={styles.closeBtn}
              onClick={onClose}
              aria-label="Закрыть настройку меню"
            >
              <X size={16} />
            </button>
          </div>

          <div className={styles.body}>
            <div className={styles.sectionLabel}>
              <GripVertical size={12} aria-hidden="true" />
              Порядок и группы — перетаскивайте за рукоятку
            </div>
            <div className={styles.list}>
              {rows.map((row, index) => renderTopRow(row, index))}
            </div>

            <button type="button" className={styles.addGroupBtn} onClick={addGroup}>
              <Plus size={15} aria-hidden="true" />
              Новая группа (выпадающий список)
            </button>

            {hidden.length > 0 && (
              <div className={styles.hiddenBlock}>
                <button
                  type="button"
                  className={styles.hiddenHead}
                  onClick={() => setHiddenOpen((v) => !v)}
                  aria-expanded={hiddenOpen}
                >
                  <EyeOff size={13} aria-hidden="true" />
                  Скрытые разделы
                  <span className={styles.hiddenCount}>{hidden.length}</span>
                  <ChevronDown
                    size={14}
                    className={`${styles.hiddenChevron}${hiddenOpen ? ` ${styles.hiddenChevronOpen}` : ""}`}
                    aria-hidden="true"
                  />
                </button>
                {hiddenOpen && (
                  <div className={styles.hiddenList}>
                    {hidden.map((key) => {
                      const def = itemBy.get(key);
                      if (!def) return null;
                      const Icon = getNavIcon(def.icon);
                      return (
                        <div key={key} className={styles.hiddenRow}>
                          <span className={styles.rowIcon}>
                            <Icon size={15} aria-hidden="true" />
                          </span>
                          <span className={styles.rowLabel}>{def.label}</span>
                          <button
                            type="button"
                            className={styles.restoreBtn}
                            onClick={() => showKey(key)}
                          >
                            <Eye size={13} aria-hidden="true" />
                            Вернуть
                          </button>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
          </div>

          <div className={styles.foot}>
            <span
              className={`${styles.statusNote}${status === "error" ? ` ${styles.statusError}` : ""}${status === "saved" ? ` ${styles.statusSaved}` : ""}`}
            >
              {status === "error"
                ? "Не удалось сохранить. Проверьте подключение и миграцию БД."
                : status === "saved"
                  ? "Сохранено — меню обновлено."
                  : "Изменения применяются сразу после сохранения."}
            </span>
            <button type="button" className={styles.resetBtn} onClick={handleReset}>
              <RotateCcw size={13} aria-hidden="true" />
              Сбросить
            </button>
            <button
              type="button"
              className={styles.saveBtn}
              onClick={handleSave}
              disabled={status === "saving"}
            >
              {status === "saving" ? (
                <Loader2 size={14} aria-hidden="true" className={styles.spinner} />
              ) : status === "saved" ? (
                <Check size={14} aria-hidden="true" />
              ) : (
                <Save size={14} aria-hidden="true" />
              )}
              {status === "saved" ? "Сохранено" : "Сохранить"}
            </button>
          </div>
        </div>
      </div>

      {/* Поверх модалки — выбор иконки для группы. */}
      {pickerGroup && (
        <div
          className={styles.pickerOverlay}
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setIconPickerFor(null);
          }}
        >
          <div className={styles.picker} role="dialog" aria-modal="true" aria-label="Иконка группы">
            <h3 className={styles.pickerTitle}>
              Иконка группы «{pickerGroup.title.trim() || "Группа"}»
            </h3>
            <div className={styles.pickerGrid}>
              {NAV_GROUP_ICON_CHOICES.map((iconId) => {
                const Icon = NAV_ICON_MAP[iconId];
                if (!Icon) return null;
                const active = pickerGroup.icon === iconId;
                return (
                  <button
                    key={iconId}
                    type="button"
                    className={`${styles.pickerItem}${active ? ` ${styles.pickerItemActive}` : ""}`}
                    onClick={() => {
                      patchGroup(pickerGroup.id, { icon: iconId });
                      setIconPickerFor(null);
                    }}
                    aria-label={iconId}
                    title={iconId}
                  >
                    <Icon size={17} />
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </ModalPortal>
  );
}
