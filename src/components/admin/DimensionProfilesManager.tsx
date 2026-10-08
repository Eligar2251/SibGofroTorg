// =========================================================
// FILE: src/components/admin/DimensionProfilesManager.tsx
// Админка: «Типы размеров» — какие поля размеров у товаров
// категории, в каком порядке и в каких единицах по умолчанию.
// Коробки: Д×Ш×В мм · Скотч: Ширина мм × Длина м × Толщина мкм.
// =========================================================

"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Plus,
  Save,
  Loader2,
  Trash2,
  Pencil,
  X,
  ArrowUp,
  ArrowDown,
  AlertCircle,
  Ruler,
  Star,
} from "lucide-react";
import {
  DIMENSION_UNITS,
  makeFieldKey,
  formatDimensionValues,
  type DimensionField,
  type DimensionProfile,
} from "@/lib/dimension-profiles";

interface Draft {
  id: string | null;
  name: string;
  isDefault: boolean;
  fields: DimensionField[];
}

const EMPTY_DRAFT: Draft = {
  id: null,
  name: "",
  isDefault: false,
  fields: [
    { key: "width", label: "Ширина", unit: "мм" },
    { key: "length", label: "Длина", unit: "м" },
  ],
};

/** Пример строки размеров для подсказки: 48 мм × 120 м × 45 мкм. */
function previewOf(fields: DimensionField[]): string {
  const sample = [48, 120, 45, 10, 5];
  return (
    formatDimensionValues(
      fields.map((f, i) => ({ key: f.key, label: f.label, unit: f.unit, value: sample[i] ?? 1 }))
    ) || "—"
  );
}

export function DimensionProfilesManager({ profiles: initial }: { profiles: DimensionProfile[] }) {
  const router = useRouter();
  const [profiles, setProfiles] = useState(initial);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [error, setError] = useState("");

  useEffect(() => setProfiles(initial), [initial]);

  function edit(p: DimensionProfile) {
    setError("");
    setDraft({ id: p.id, name: p.name, isDefault: !!p.isDefault, fields: p.fields.map((f) => ({ ...f })) });
  }

  function updateField(i: number, patch: Partial<DimensionField>) {
    setDraft((d) => {
      if (!d) return d;
      const fields = d.fields.map((f, idx) => (idx === i ? { ...f, ...patch } : f));
      return { ...d, fields };
    });
  }

  function moveField(i: number, dir: -1 | 1) {
    setDraft((d) => {
      if (!d) return d;
      const j = i + dir;
      if (j < 0 || j >= d.fields.length) return d;
      const fields = [...d.fields];
      [fields[i], fields[j]] = [fields[j], fields[i]];
      return { ...d, fields };
    });
  }

  function addField() {
    setDraft((d) => {
      if (!d || d.fields.length >= 8) return d;
      const key = makeFieldKey("Толщина", d.fields.map((f) => f.key));
      return { ...d, fields: [...d.fields, { key, label: "Толщина", unit: "мкм" }] };
    });
  }

  function removeField(i: number) {
    setDraft((d) => (d ? { ...d, fields: d.fields.filter((_, idx) => idx !== i) } : d));
  }

  async function save() {
    if (!draft) return;
    const name = draft.name.trim();
    const fields = draft.fields
      .map((f) => ({ ...f, label: f.label.trim(), unit: f.unit.trim() || "мм" }))
      .filter((f) => f.label);
    if (!name) return setError("Укажите название типа");
    if (!fields.length) return setError("Добавьте хотя бы одно поле");
    // Ключ поля — из подписи, если новое поле переименовали до сохранения.
    const used = new Set<string>();
    for (const f of fields) {
      if (!f.key || used.has(f.key)) f.key = makeFieldKey(f.label, used);
      used.add(f.key);
    }

    setSaving(true);
    setError("");
    try {
      const res = await fetch(
        draft.id ? `/api/admin/dimension-profiles/${draft.id}` : "/api/admin/dimension-profiles",
        {
          method: draft.id ? "PUT" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name, fields, isDefault: draft.isDefault }),
        }
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || "Не удалось сохранить");
      } else {
        const saved: DimensionProfile = data.profile;
        setProfiles((prev) => {
          let next = draft.id ? prev.map((p) => (p.id === saved.id ? saved : p)) : [...prev, saved];
          if (saved.isDefault) next = next.map((p) => (p.id === saved.id ? p : { ...p, isDefault: false }));
          return next;
        });
        setDraft(null);
        router.refresh();
      }
    } catch {
      setError("Ошибка сети");
    }
    setSaving(false);
  }

  async function remove(p: DimensionProfile) {
    if (!confirm(`Удалить тип размеров «${p.name}»?\n\nКатегории с этим типом перейдут на тип по умолчанию. Уже введённые размеры товаров сохранятся.`)) return;
    setDeletingId(p.id);
    setError("");
    try {
      const res = await fetch(`/api/admin/dimension-profiles/${p.id}`, { method: "DELETE" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) setError(data.error || "Не удалось удалить");
      else {
        setProfiles((prev) => prev.filter((x) => x.id !== p.id));
        router.refresh();
      }
    } catch {
      setError("Ошибка сети");
    }
    setDeletingId(null);
  }

  return (
    <div className="admin-card">
      <div className="admin-card__pad admin-stack">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <div>
            <h2 className="admin-h2" style={{ display: "flex", alignItems: "center", gap: 8, margin: 0 }}>
              <Ruler size={18} /> Типы размеров
            </h2>
            <div className="admin-hint">
              Какие размеры вводятся у товаров категории и в каком порядке. У каждого поля своя
              единица: скотч — «48 мм × 120 м × 45 мкм», коробка — «600×400×400 мм».
            </div>
          </div>
          {!draft && (
            <button type="button" className="admin-btn admin-btn--primary" onClick={() => { setError(""); setDraft({ ...EMPTY_DRAFT, fields: EMPTY_DRAFT.fields.map((f) => ({ ...f })) }); }}>
              <Plus size={15} /> Новый тип
            </button>
          )}
        </div>

        {profiles.length === 0 && !draft && (
          <div className="admin-error">
            <AlertCircle size={14} /> Типов размеров нет. Если их не видно после деплоя — выполните
            supabase/migration_dimension_profiles.sql в Supabase (создаст «Коробки», «Скотч», «Стрейч-плёнка»).
          </div>
        )}

        {profiles.length > 0 && (
          <div className="admin-table-wrap">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>Тип</th>
                  <th>Поля по порядку</th>
                  <th>Пример</th>
                  <th style={{ width: 96 }} />
                </tr>
              </thead>
              <tbody>
                {profiles.map((p) => (
                  <tr key={p.id}>
                    <td>
                      <strong>{p.name}</strong>
                      {p.isDefault && (
                        <span className="admin-badge admin-badge--green" style={{ marginLeft: 8 }}>
                          <Star size={10} /> по умолчанию
                        </span>
                      )}
                    </td>
                    <td>{p.fields.map((f) => `${f.label} (${f.unit})`).join(" → ")}</td>
                    <td className="admin-mono">{previewOf(p.fields)}</td>
                    <td>
                      <div style={{ display: "flex", gap: 4 }}>
                        <button type="button" className="admin-btn admin-btn--icon" title="Изменить" onClick={() => edit(p)}>
                          <Pencil size={15} />
                        </button>
                        <button type="button" className="admin-btn admin-btn--icon" title="Удалить" disabled={deletingId === p.id} onClick={() => remove(p)}>
                          {deletingId === p.id ? <Loader2 size={15} className="animate-spin" /> : <Trash2 size={15} />}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {draft && (
          <div className="admin-card" style={{ background: "var(--adm-bg, #f8fafc)" }}>
            <div className="admin-card__pad admin-stack">
              <h3 className="admin-h2" style={{ margin: 0 }}>
                {draft.id ? "Изменить тип размеров" : "Новый тип размеров"}
              </h3>
              <div className="admin-grid-3">
                <div className="admin-field">
                  <label className="admin-label">Название *</label>
                  <input
                    className="admin-input"
                    value={draft.name}
                    onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                    placeholder="Скотч (Ш×Д×мкм)"
                  />
                </div>
                <div className="admin-field" style={{ justifyContent: "flex-end" }}>
                  <label className="admin-check" style={{ display: "flex", gap: 8, alignItems: "center" }}>
                    <input
                      type="checkbox"
                      checked={draft.isDefault}
                      onChange={(e) => setDraft({ ...draft, isDefault: e.target.checked })}
                    />
                    По умолчанию (для категорий без своего типа)
                  </label>
                </div>
              </div>

              <div className="admin-stack" style={{ gap: 8 }}>
                <div className="admin-label">Поля размеров — в порядке вывода на сайте</div>
                {draft.fields.map((f, i) => (
                  <div key={i} style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                    <span className="admin-mono" style={{ width: 22, textAlign: "right" }}>{i + 1}.</span>
                    <input
                      className="admin-input"
                      style={{ flex: "1 1 180px", maxWidth: 260 }}
                      value={f.label}
                      onChange={(e) => updateField(i, { label: e.target.value })}
                      placeholder="Название поля"
                      aria-label="Название поля"
                    />
                    <input
                      className="admin-input"
                      style={{ width: 90 }}
                      list="dimension-units"
                      value={f.unit}
                      onChange={(e) => updateField(i, { unit: e.target.value })}
                      placeholder="мм"
                      aria-label="Единица по умолчанию"
                      title="Единица по умолчанию (в товаре можно выбрать другую)"
                    />
                    <button type="button" className="admin-btn admin-btn--icon" disabled={i === 0} onClick={() => moveField(i, -1)} title="Выше"><ArrowUp size={14} /></button>
                    <button type="button" className="admin-btn admin-btn--icon" disabled={i === draft.fields.length - 1} onClick={() => moveField(i, 1)} title="Ниже"><ArrowDown size={14} /></button>
                    <button type="button" className="admin-btn admin-btn--icon" onClick={() => removeField(i)} title="Убрать поле"><X size={14} /></button>
                  </div>
                ))}
                <datalist id="dimension-units">
                  {DIMENSION_UNITS.map((u) => <option key={u} value={u} />)}
                </datalist>
                <div>
                  <button type="button" className="admin-btn admin-btn--ghost" onClick={addField} disabled={draft.fields.length >= 8}>
                    <Plus size={14} /> Добавить поле
                  </button>
                </div>
                <div className="admin-hint">
                  Пример на сайте: <strong>{previewOf(draft.fields.filter((f) => f.label.trim()))}</strong>.
                  Поля «Длина», «Ширина», «Высота» также используются в подборе коробок и расчёте объёма.
                </div>
              </div>

              <div className="admin-row">
                <button type="button" className="admin-btn admin-btn--navy" onClick={save} disabled={saving}>
                  {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />} Сохранить
                </button>
                <button type="button" className="admin-btn admin-btn--ghost" onClick={() => { setDraft(null); setError(""); }}>
                  Отмена
                </button>
              </div>
            </div>
          </div>
        )}

        {error && (
          <div className="admin-error">
            <AlertCircle size={14} /> {error}
          </div>
        )}
      </div>
    </div>
  );
}
