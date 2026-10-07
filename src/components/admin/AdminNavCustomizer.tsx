// =========================================================
// FILE: src/components/admin/AdminNavCustomizer.tsx
// Настройка групп, порядка и иконок меню админки.
// Сохраняется в базе отдельно для текущего пользователя.
// =========================================================

"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import {
  ArrowDown,
  ArrowUp,
  Check,
  GripVertical,
  Plus,
  RotateCcw,
  Search,
  Trash2,
  X,
} from "lucide-react";
import { ModalPortal } from "./ModalPortal";
import { AdminNavIcon } from "./AdminNavIcon";
import { AdminNavMenu } from "./AdminNavMenu";
import {
  ADMIN_NAV_ICON_GROUPS,
  ADMIN_NAV_ICONS,
  DEFAULT_GROUP_ICON,
  cleanNavLabel,
  newNavGroupId,
  presetNavLayout,
  sanitizeNavLayout,
  type AdminNavGroup,
  type AdminNavItemDef,
  type AdminNavLayout,
} from "@/lib/admin-nav";

type DraftGroup = {
  id: string;
  label: string;
  icon: string;
  itemIds: string[];
};

type Draft = {
  root: string[];
  groups: Record<string, DraftGroup>;
  icons: Record<string, string>;
  labels: Record<string, string>;
};

type Selection = { kind: "item" | "group"; id: string } | null;

function draftFrom(items: readonly AdminNavItemDef[], layout: AdminNavLayout | null): Draft {
  const ids = items.map((item) => item.id);
  const clean = layout ? sanitizeNavLayout(layout, ids) : null;
  if (!clean) {
    return { root: ids, groups: {}, icons: {}, labels: {} };
  }
  const groups: Record<string, DraftGroup> = {};
  for (const group of clean.groups) {
    groups[group.id] = {
      id: group.id,
      label: group.label,
      icon: group.icon,
      itemIds: [...group.itemIds],
    };
  }
  return {
    root: clean.order.map((node) => node.id),
    groups,
    icons: { ...clean.icons },
    labels: { ...clean.labels },
  };
}

function draftToLayout(draft: Draft, items: readonly AdminNavItemDef[]): AdminNavLayout {
  const ids = items.map((item) => item.id);
  const groups: AdminNavGroup[] = Object.values(draft.groups).map((group) => ({
    id: group.id,
    label: cleanNavLabel(group.label) || "Группа",
    icon: group.icon || DEFAULT_GROUP_ICON,
    itemIds: group.itemIds.filter((id) => ids.includes(id)),
  }));
  const groupIds = new Set(groups.map((group) => group.id));
  const layout = sanitizeNavLayout(
    {
      version: 1,
      order: draft.root
        .filter((id) => groupIds.has(id) || ids.includes(id))
        .map((id) =>
          groupIds.has(id) ? { type: "group" as const, id } : { type: "item" as const, id },
        ),
      groups,
      icons: draft.icons,
      labels: draft.labels,
    },
    ids,
  );
  return (
    layout ?? {
      version: 1,
      order: ids.map((id) => ({ type: "item" as const, id })),
      groups: [],
      icons: {},
      labels: {},
    }
  );
}

function removeId(list: string[], id: string) {
  return list.filter((item) => item !== id);
}

function insertAt(list: string[], id: string, index: number) {
  const next = list.slice();
  const at = Math.max(0, Math.min(index, next.length));
  next.splice(at, 0, id);
  return next;
}

function placeItem(draft: Draft, itemId: string, groupId: string | null, index: number): Draft {
  if (draft.groups[itemId]) return draft;
  const groups = Object.fromEntries(
    Object.entries(draft.groups).map(([id, group]) => [
      id,
      { ...group, itemIds: removeId(group.itemIds, itemId) },
    ]),
  );
  const root = removeId(draft.root, itemId);
  if (!groupId || !groups[groupId]) {
    return { ...draft, groups, root: insertAt(root, itemId, index) };
  }
  return {
    ...draft,
    root,
    groups: {
      ...groups,
      [groupId]: {
        ...groups[groupId],
        itemIds: insertAt(groups[groupId].itemIds, itemId, index),
      },
    },
  };
}

export function AdminNavCustomizer({
  items,
  layout,
  username,
  saving,
  error,
  onClose,
  onSave,
  onReset,
}: {
  items: readonly AdminNavItemDef[];
  layout: AdminNavLayout | null;
  username: string;
  saving: boolean;
  error: string | null;
  onClose: () => void;
  onSave: (layout: AdminNavLayout) => Promise<void>;
  onReset: () => Promise<void>;
}) {
  const pathname = usePathname() || "";
  const adminPath = items[0]?.href.split("/").filter(Boolean)[0] || "admin";
  const [draft, setDraft] = useState<Draft>(() => draftFrom(items, layout));
  const [selected, setSelected] = useState<Selection>(null);
  const [query, setQuery] = useState("");
  const [iconGroup, setIconGroup] = useState("Все");
  const [localError, setLocalError] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [dragId, setDragId] = useState<string | null>(null);

  const byId = useMemo(() => new Map(items.map((item) => [item.id, item])), [items]);
  const preview = useMemo(() => draftToLayout(draft, items), [draft, items]);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      event.preventDefault();
      requestClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // requestClose читает актуальный dirty через замыкание эффекта ниже.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dirty, saving]);

  function touch(next: Draft) {
    setDirty(true);
    setDraft(next);
  }

  function requestClose() {
    if (saving) return;
    if (dirty && !window.confirm("Закрыть без сохранения изменений меню?")) return;
    onClose();
  }

  function move(id: string, dir: -1 | 1) {
    const group = Object.values(draft.groups).find((entry) => entry.itemIds.includes(id));
    if (group) {
      const index = group.itemIds.indexOf(id);
      const next = index + dir;
      if (next < 0 || next >= group.itemIds.length) return;
      const itemIds = group.itemIds.slice();
      const [row] = itemIds.splice(index, 1);
      itemIds.splice(next, 0, row);
      touch({
        ...draft,
        groups: { ...draft.groups, [group.id]: { ...group, itemIds } },
      });
      return;
    }
    const index = draft.root.indexOf(id);
    if (index < 0) return;
    const next = index + dir;
    if (next < 0 || next >= draft.root.length) return;
    const root = draft.root.slice();
    const [row] = root.splice(index, 1);
    root.splice(next, 0, row);
    touch({ ...draft, root });
  }

  function moveItemTo(itemId: string, groupId: string) {
    if (draft.groups[itemId]) return;
    const target = groupId || null;
    const index = target && draft.groups[target] ? draft.groups[target].itemIds.length : draft.root.length;
    touch(placeItem(draft, itemId, target, index));
  }

  function createGroup() {
    const id = newNavGroupId();
    const group: DraftGroup = {
      id,
      label: "Новая группа",
      icon: DEFAULT_GROUP_ICON,
      itemIds: [],
    };
    const dashboardAt = draft.root.indexOf("dashboard");
    const at = dashboardAt >= 0 ? dashboardAt + 1 : 0;
    touch({
      ...draft,
      groups: { ...draft.groups, [id]: group },
      root: insertAt(draft.root, id, at),
    });
    setSelected({ kind: "group", id });
  }

  function deleteGroup(id: string) {
    const group = draft.groups[id];
    if (!group) return;
    const index = draft.root.indexOf(id);
    const root = removeId(draft.root, id);
    const nextRoot = root.slice();
    nextRoot.splice(Math.max(index, 0), 0, ...group.itemIds);
    const groups = { ...draft.groups };
    delete groups[id];
    touch({ ...draft, root: nextRoot, groups });
    if (selected?.id === id) setSelected(null);
  }

  function setGroupLabel(id: string, label: string) {
    const group = draft.groups[id];
    if (!group) return;
    touch({ ...draft, groups: { ...draft.groups, [id]: { ...group, label } } });
  }

  function setItemLabel(id: string, label: string) {
    const labels = { ...draft.labels };
    const clean = cleanNavLabel(label);
    const fallback = byId.get(id)?.label || "";
    if (!clean || clean === fallback) delete labels[id];
    else labels[id] = clean;
    touch({ ...draft, labels });
  }

  function applyIcon(iconId: string) {
    if (!selected) return;
    if (selected.kind === "group") {
      const group = draft.groups[selected.id];
      if (!group) return;
      touch({
        ...draft,
        groups: { ...draft.groups, [group.id]: { ...group, icon: iconId } },
      });
      return;
    }
    const fallback = byId.get(selected.id)?.icon;
    const icons = { ...draft.icons };
    if (iconId === fallback) delete icons[selected.id];
    else icons[selected.id] = iconId;
    touch({ ...draft, icons });
  }

  function currentIconId(): string | null {
    if (!selected) return null;
    if (selected.kind === "group") return draft.groups[selected.id]?.icon || DEFAULT_GROUP_ICON;
    return draft.icons[selected.id] || byId.get(selected.id)?.icon || null;
  }

  function selectedTitle(): string {
    if (!selected) return "Иконка";
    if (selected.kind === "group") {
      return draft.groups[selected.id]?.label || "Группа";
    }
    return draft.labels[selected.id] || byId.get(selected.id)?.label || "Вкладка";
  }

  async function save() {
    setLocalError(null);
    try {
      await onSave(draftToLayout(draft, items));
      setDirty(false);
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : "Не удалось сохранить меню");
    }
  }

  async function reset() {
    if (!window.confirm("Вернуть стандартный порядок вкладок без групп? Это сохранится для вашего аккаунта.")) {
      return;
    }
    setLocalError(null);
    try {
      await onReset();
      setDirty(false);
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : "Не удалось сбросить меню");
    }
  }

  function onDrop(targetGroupId: string | null, index: number) {
    if (!dragId) return;
    if (draft.groups[dragId]) {
      if (targetGroupId) return;
      const root = removeId(draft.root, dragId);
      touch({ ...draft, root: insertAt(root, dragId, index) });
      return;
    }
    touch(placeItem(draft, dragId, targetGroupId, index));
  }

  const icons = ADMIN_NAV_ICONS.filter((icon) => {
    if (iconGroup !== "Все" && icon.group !== iconGroup) return false;
    const q = query.trim().toLowerCase();
    if (!q) return true;
    return icon.label.toLowerCase().includes(q) || icon.id.includes(q);
  });
  const activeIcon = currentIconId();
  const shownError = localError || error;

  return (
    <ModalPortal>
      <div className="admin-modal-overlay navcfg-overlay" onMouseDown={requestClose}>
        <div
          className="admin-modal navcfg-modal"
          role="dialog"
          aria-modal="true"
          aria-labelledby="navcfg-title"
          onMouseDown={(event) => event.stopPropagation()}
        >
          <header className="navcfg-head">
            <div>
              <h2 id="navcfg-title" className="admin-modal__title">
                Настройка навигации
              </h2>
              <p className="navcfg-lead">
                Перетаскивайте разделы, объединяйте их в группы и подбирайте подписи с иконками.
                Изменения сохраняются отдельно для аккаунта <strong>{username}</strong>.
              </p>
            </div>
            <button type="button" className="admin-modal__close" onClick={requestClose} aria-label="Закрыть">
              <X size={18} />
            </button>
          </header>

          <div className="navcfg-body">
            <section className="navcfg-structure" aria-label="Группы и вкладки">
              <div className="navcfg-toolbar">
                <button type="button" className="admin-btn admin-btn--outline admin-btn--sm" onClick={createGroup}>
                  <Plus size={14} /> Новая группа
                </button>
                <button
                  type="button"
                  className="admin-btn admin-btn--ghost admin-btn--sm"
                  onClick={() => {
                    touch(draftFrom(items, presetNavLayout(items.map((item) => item.id))));
                    setSelected(null);
                  }}
                >
                  Собрать по разделам
                </button>
              </div>

              <div className="navcfg-preview" aria-label="Предпросмотр меню">
                <div className="navcfg-preview__cap">Предпросмотр</div>
                <AdminNavMenu
                  items={items}
                  layout={preview}
                  pathname={pathname}
                  adminPath={adminPath}
                  interactive={false}
                />
              </div>

              <ol className="navcfg-list">
                {draft.root.map((id, index) => {
                  const group = draft.groups[id];
                  if (group) {
                    return (
                      <li key={id}>
                        <GroupEditor
                          group={group}
                          itemsById={byId}
                          draft={draft}
                          selected={selected}
                          onSelect={setSelected}
                          onLabel={(label) => setGroupLabel(id, label)}
                          onDelete={() => deleteGroup(id)}
                          onMove={(itemId, dir) => move(itemId, dir)}
                          onMoveItem={moveItemTo}
                          onItemLabel={setItemLabel}
                          onDragStart={setDragId}
                          onDrop={onDrop}
                          canUp={index > 0}
                          canDown={index < draft.root.length - 1}
                          onMoveGroup={(dir) => move(id, dir)}
                        />
                      </li>
                    );
                  }
                  const item = byId.get(id);
                  if (!item) return null;
                  return (
                    <li key={id}>
                      <ItemRow
                        item={item}
                        label={draft.labels[id] || ""}
                        icon={draft.icons[id] || item.icon}
                        selected={selected?.kind === "item" && selected.id === id}
                        groups={Object.values(draft.groups)}
                        groupId=""
                        canUp={index > 0}
                        canDown={index < draft.root.length - 1}
                        onSelect={() => setSelected({ kind: "item", id })}
                        onLabel={(label) => setItemLabel(id, label)}
                        onMove={(dir) => move(id, dir)}
                        onMoveItem={(target) => moveItemTo(id, target)}
                        onDragStart={() => setDragId(id)}
                        onDrop={() => onDrop(null, index)}
                      />
                    </li>
                  );
                })}
              </ol>
            </section>

            <aside className="navcfg-icons" aria-label="Выбор иконки">
              <div className="navcfg-icons__head">
                <strong>{selected ? `Иконка · ${selectedTitle()}` : "Иконки"}</strong>
                <span>В одной линии с текстом, 18×18</span>
              </div>
              {!selected && (
                <p className="navcfg-hint">
                  Выберите группу или вкладку слева — здесь можно задать любую иконку.
                  Иконка группы и иконка вкладки настраиваются отдельно.
                </p>
              )}
              <label className="navcfg-search">
                <Search size={14} aria-hidden="true" />
                <input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Найти иконку"
                  aria-label="Найти иконку"
                />
              </label>
              <div className="navcfg-chips" role="tablist" aria-label="Разделы иконок">
                {ADMIN_NAV_ICON_GROUPS.map((group) => (
                  <button
                    key={group}
                    type="button"
                    className={`navcfg-chip${iconGroup === group ? " is-on" : ""}`}
                    onClick={() => setIconGroup(group)}
                  >
                    {group}
                  </button>
                ))}
              </div>
              <div className="navcfg-icon-grid">
                {icons.map((icon) => {
                  const on = icon.id === activeIcon;
                  return (
                    <button
                      key={icon.id}
                      type="button"
                      className={`navcfg-icon-opt${on ? " is-on" : ""}`}
                      title={icon.label}
                      aria-pressed={on}
                      disabled={!selected}
                      onClick={() => applyIcon(icon.id)}
                    >
                      <AdminNavIcon id={icon.id} size={18} />
                      <span>{icon.label}</span>
                      {on && <Check size={12} className="navcfg-icon-opt__check" aria-hidden="true" />}
                    </button>
                  );
                })}
              </div>
            </aside>
          </div>

          <footer className="navcfg-foot">
            {shownError && <p className="navcfg-error">{shownError}</p>}
            <div className="navcfg-foot__actions">
              <button type="button" className="admin-btn admin-btn--ghost admin-btn--sm" onClick={reset} disabled={saving}>
                <RotateCcw size={14} /> Сбросить моё меню
              </button>
              <div className="navcfg-foot__main">
                <button type="button" className="admin-btn admin-btn--ghost" onClick={requestClose} disabled={saving}>
                  Отмена
                </button>
                <button type="button" className="admin-btn admin-btn--primary" onClick={save} disabled={saving}>
                  {saving ? "Сохраняю…" : "Сохранить в базу"}
                </button>
              </div>
            </div>
          </footer>
        </div>
      </div>
    </ModalPortal>
  );
}

function GroupEditor({
  group,
  itemsById,
  draft,
  selected,
  onSelect,
  onLabel,
  onDelete,
  onMove,
  onMoveItem,
  onItemLabel,
  onDragStart,
  onDrop,
  canUp,
  canDown,
  onMoveGroup,
}: {
  group: DraftGroup;
  itemsById: Map<string, AdminNavItemDef>;
  draft: Draft;
  selected: Selection;
  onSelect: (selection: Selection) => void;
  onLabel: (label: string) => void;
  onDelete: () => void;
  onMove: (id: string, dir: -1 | 1) => void;
  onMoveItem: (itemId: string, groupId: string) => void;
  onItemLabel: (id: string, label: string) => void;
  onDragStart: (id: string) => void;
  onDrop: (groupId: string | null, index: number) => void;
  canUp: boolean;
  canDown: boolean;
  onMoveGroup: (dir: -1 | 1) => void;
}) {
  const selectedGroup = selected?.kind === "group" && selected.id === group.id;
  return (
    <div
      className={`navcfg-group${selectedGroup ? " is-selected" : ""}`}
      onDragOver={(event) => event.preventDefault()}
      onDrop={(event) => {
        event.preventDefault();
        event.stopPropagation();
        onDrop(group.id, group.itemIds.length);
      }}
    >
      <div className="navcfg-row navcfg-row--group">
      <span
        className="navcfg-grip"
        draggable
        onDragStart={(event) => {
          event.dataTransfer.setData("text/plain", group.id);
          event.dataTransfer.effectAllowed = "move";
          onDragStart(group.id);
        }}
        title="Перетащить группу"
        aria-hidden="true"
      >
          <GripVertical size={14} />
        </span>
        <button
          type="button"
          className={`navcfg-ico${selectedGroup ? " is-on" : ""}`}
          onClick={() => onSelect({ kind: "group", id: group.id })}
          aria-label={`Иконка группы ${group.label}`}
          title="Сменить иконку группы"
        >
          <AdminNavIcon id={group.icon || DEFAULT_GROUP_ICON} size={18} />
        </button>
        <input
          className="navcfg-name"
          value={group.label}
          maxLength={40}
          aria-label="Название группы"
          onChange={(event) => onLabel(event.target.value)}
          onFocus={() => onSelect({ kind: "group", id: group.id })}
        />
        <div className="navcfg-row__tools">
          <IconTool title="Выше" disabled={!canUp} onClick={() => onMoveGroup(-1)}>
            <ArrowUp size={14} />
          </IconTool>
          <IconTool title="Ниже" disabled={!canDown} onClick={() => onMoveGroup(1)}>
            <ArrowDown size={14} />
          </IconTool>
          <IconTool title="Распустить группу" onClick={onDelete}>
            <Trash2 size={14} />
          </IconTool>
        </div>
      </div>
      <ul className="navcfg-group__items">
        {group.itemIds.length === 0 && (
          <li className="navcfg-empty">Перетащите вкладки сюда или выберите группу в списке справа у вкладки</li>
        )}
        {group.itemIds.map((itemId, index) => {
          const item = itemsById.get(itemId);
          if (!item) return null;
          return (
            <li key={itemId}>
              <ItemRow
                item={item}
                label={draft.labels[itemId] || ""}
                icon={draft.icons[itemId] || item.icon}
                selected={selected?.kind === "item" && selected.id === itemId}
                groups={Object.values(draft.groups)}
                groupId={group.id}
                canUp={index > 0}
                canDown={index < group.itemIds.length - 1}
                nested
                onSelect={() => onSelect({ kind: "item", id: itemId })}
                onLabel={(value) => onItemLabel(itemId, value)}
                onMove={(dir) => onMove(itemId, dir)}
                onMoveItem={(target) => onMoveItem(itemId, target)}
                onDragStart={() => onDragStart(itemId)}
                onDrop={() => onDrop(group.id, index)}
              />
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function ItemRow({
  item,
  label,
  icon,
  selected,
  groups,
  groupId,
  canUp,
  canDown,
  nested = false,
  onSelect,
  onLabel,
  onMove,
  onMoveItem,
  onDragStart,
  onDrop,
}: {
  item: AdminNavItemDef;
  label: string;
  icon: string;
  selected: boolean;
  groups: DraftGroup[];
  groupId: string;
  canUp: boolean;
  canDown: boolean;
  nested?: boolean;
  onSelect: () => void;
  onLabel: (label: string) => void;
  onMove: (dir: -1 | 1) => void;
  onMoveItem: (groupId: string) => void;
  onDragStart: () => void;
  onDrop: () => void;
}) {
  return (
    <div
      className={`navcfg-row${nested ? " navcfg-row--nested" : ""}${selected ? " is-selected" : ""}`}
      onDragOver={(event) => {
        event.preventDefault();
        event.stopPropagation();
      }}
      onDrop={(event) => {
        event.preventDefault();
        event.stopPropagation();
        onDrop();
      }}
    >
      <span
        className="navcfg-grip"
        draggable
        onDragStart={(event) => {
          event.dataTransfer.setData("text/plain", item.id);
          event.dataTransfer.effectAllowed = "move";
          onDragStart();
        }}
        title="Перетащить вкладку"
        aria-hidden="true"
      >
        <GripVertical size={14} />
      </span>
      <button
        type="button"
        className={`navcfg-ico${selected ? " is-on" : ""}`}
        onClick={onSelect}
        aria-label={`Иконка вкладки ${item.label}`}
        title="Сменить иконку"
      >
        <AdminNavIcon id={icon} size={18} />
      </button>
      <input
        className="navcfg-name"
        value={label}
        maxLength={40}
        placeholder={item.label}
        aria-label={`Подпись вкладки ${item.label}`}
        onChange={(event) => onLabel(event.target.value)}
        onFocus={onSelect}
      />
      <div className="navcfg-row__tools">
        <label className="navcfg-move">
          <span className="sr-only">Куда поместить</span>
          <select
            value={groupId}
            aria-label={`Группа для «${item.label}»`}
            onChange={(event) => onMoveItem(event.target.value)}
          >
            <option value="">В общем списке</option>
            {groups.map((group) => (
              <option key={group.id} value={group.id}>
                {group.label || "Группа"}
              </option>
            ))}
          </select>
        </label>
        <IconTool title="Выше" disabled={!canUp} onClick={() => onMove(-1)}>
          <ArrowUp size={14} />
        </IconTool>
        <IconTool title="Ниже" disabled={!canDown} onClick={() => onMove(1)}>
          <ArrowDown size={14} />
        </IconTool>
      </div>
    </div>
  );
}

function IconTool({
  title,
  disabled,
  onClick,
  children,
}: {
  title: string;
  disabled?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button type="button" className="navcfg-tool" title={title} aria-label={title} disabled={disabled} onClick={onClick}>
      {children}
    </button>
  );
}
